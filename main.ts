import { Plugin, PluginSettingTab, App, Setting, Notice } from 'obsidian';
import { GoogleTasksApi } from './googleApi';

interface GoogleTasksSyncroSettings {
	clientId: string;
	clientSecret: string;
	accessToken: string;
	refreshToken: string;
	defaultListName: string;
	carpetasExcluidas: string[];
	intervaloSincronizacion: number;
	mapeoTareas: Record<string, string>; 
	mapeoListasTareas: Record<string, string>; 
}

const DEFAULT_SETTINGS: GoogleTasksSyncroSettings = {
	clientId: '',
	clientSecret: '',
	accessToken: '',
	refreshToken: '',
	defaultListName: 'Inbox',
	carpetasExcluidas: ['Plantillas'],
	intervaloSincronizacion: 15,
	mapeoTareas: {},
	mapeoListasTareas: {}
};

export default class GoogleTasksSyncro extends Plugin {
	settings: GoogleTasksSyncroSettings = DEFAULT_SETTINGS;
	api = new GoogleTasksApi(this);
	listasCache: any[] = [];
	temporizadorSincro: any = null; 
	estaSincronizando: boolean = false;

	async onload() {
		console.log('Cargando Google Tasks Syncro V13.0 (Sincronización Bidireccional)...');
		await this.loadSettings();
		this.addSettingTab(new GoogleTasksSyncroSettingTab(this.app, this));

		this.addRibbonIcon('sync', 'Sincronizar Google Tasks', async () => {
			if (this.estaSincronizando) {
				new Notice('Ya hay una sincronización en curso...');
				return;
			}
			new Notice('Iniciando sincronización con Google Tasks...');
			await this.ejecutarSincronizacionCompleta();
		});

		this.configurarTemporizador();
	}

	onunload() {
		if (this.temporizadorSincro) {
			clearInterval(this.temporizadorSincro);
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	configurarTemporizador() {
		if (this.temporizadorSincro) {
			clearInterval(this.temporizadorSincro);
			this.temporizadorSincro = null;
		}
		const minutos = this.settings.intervaloSincronizacion;
		if (minutos > 0) {
			this.temporizadorSincro = setInterval(async () => {
				if (!this.estaSincronizando) {
					await this.ejecutarSincronizacionCompleta();
				}
			}, minutos * 60 * 1000);
		}
	}

	generarHashCorto(str: string): number {
		let hash = 0;
		for (let i = 0; i < str.length; i++) {
			hash = (hash << 5) - hash + str.charCodeAt(i);
			hash |= 0;
		}
		return hash;
	}

	async ejecutarSincronizacionCompleta() {
		if (!this.settings || !this.settings.accessToken) {
			new Notice('Error: Plugin no configurado o sin token de Google válido.');
			return;
		}

		this.estaSincronizando = true;
		try {
			this.listasCache = await this.api.obtenerListasTareas();
			if (!this.listasCache || this.listasCache.length === 0) {
				new Notice('No se pudieron obtener las listas de Google Tasks.');
				this.estaSincronizando = false;
				return;
			}

			// 1. Descargar todo el mapa actual de Google Tasks con marca de tiempo y fecha de vencimiento
			const mapaHashGoogle = new Map<string, { googleId: string, listId: string, title: string, completed: boolean, due?: string, updated: number }>();
			for (const lista of this.listasCache) {
				const tareasGoogle = await this.api.obtenerTareasDeLista(lista.id);
				for (const t of tareasGoogle) {
					if (t.notes && t.notes.includes('Hash: ^')) {
						const match = t.notes.match(/Hash:\s*\^([a-z0-9]{5,8})/);
						if (match) {
							// Extraemos solo la parte YYYY-MM-DD de la fecha de Google si existe
							const fechaDueGoogle = t.due ? t.due.substring(0, 10) : undefined;
							mapaHashGoogle.set(match[1], { 
								googleId: t.id, 
								listId: lista.id,
								title: t.title || '',
								completed: t.status === 'completed',
								due: fechaDueGoogle,
								updated: t.updated ? Date.parse(t.updated) : 0
							});
						}
					}
				}
			}

			const listaInbox = this.listasCache.find((l: any) => l.title?.toLowerCase() === this.settings.defaultListName.toLowerCase());
			const archivos = this.app.vault.getMarkdownFiles();
			
			// Obtener la hora del sistema para control de modificaciones locales aproximadas
			const ahoraTimestamp = Date.now();

			let tareasCreadas = 0;
			let tareasActualizadasInCloud = 0;
			let tareasActualizadasInObsidian = 0;

			for (const archivo of archivos) {
				const esExcluido = this.settings.carpetasExcluidas.some(carpeta => {
					const cTrim = carpeta.trim();
					return cTrim !== '' && archivo.path.toLowerCase().includes(cTrim.toLowerCase());
				});
				if (esExcluido) continue;

				const partesRuta = archivo.path.split('/');
				let nombreCarpeta = this.settings.defaultListName;
				if (partesRuta.length > 1) {
					nombreCarpeta = partesRuta[partesRuta.length - 2];
				}

				let listaDestino = this.listasCache.find((l: any) => l.title?.toLowerCase() === nombreCarpeta.toLowerCase()) || listaInbox;
				if (!listaDestino) continue;

				// Obtener fecha de modificación real del archivo físico de Obsidian
				const archivoStat = await this.app.vault.adapter.stat(archivo.path);
				const ultimaModificacionArchivo = archivoStat ? archivoStat.mtime : ahoraTimestamp;

				let contenido = await this.app.vault.read(archivo);
				let lineas = contenido.split('\n');
				let huboCambiosEnMarkdown = false;

				const colaTareasNuevas: { i: number, hash: string, titulo: string, fecha?: string, sangria: string }[] = [];

				for (let i = 0; i < lineas.length; i++) {
					const linea = lineas[i];
					const regexChecklist = /^(\s*)-\s+\[([ xX])\]\s+(.+)$/;
					const match = linea.match(regexChecklist);
					if (!match) continue;

					const sangria = match[1];
					let estadoChar = match[2];
					const textoCrudo = match[3].trim();
					let completadaEnObsidian = (estadoChar === 'x' || estadoChar === 'X');

					if (textoCrudo.length < 3) continue;

					const regexHash = /\^([a-z0-9]{5,8})/;
					const matchHash = textoCrudo.match(regexHash);

					// Extraer prioridad limpia ANTES de destruir la cadena
					const prioridadMatch = textoCrudo.match(/(⏫|🔼|🔽)/);
					const prioridadStr = prioridadMatch ? `${prioridadMatch[1]}` : '';

					// Limpieza estricta del título en Obsidian
					let tituloLimpioObsidian = textoCrudo
						.replace(/\^([a-z0-9]{5,8})/g, '')
						.replace(/📅\s*(\d{4}-\d{2}-\d{2})/, '')
						.replace(/🔁\s*[^📅⏳]*/, '')
						.replace(/[⏳🛫✅⏰]\s*\d{4}-\d{2}-\d{2}/g, '')
						.replace(/%\d+/g, '')
						.replace(/⏫|🔼|🔽/g, '')
						.trim();

					const regexFecha = /📅\s*(\d{4}-\d{2}-\d{2})/;
					const matchFecha = textoCrudo.match(regexFecha);
					let fechaISOObsidian = matchFecha ? matchFecha[1] : undefined;

					if (matchHash) {
						const hashDetectado = matchHash[1];
						let infoGoogle = mapaHashGoogle.get(hashDetectado);

						if (infoGoogle) {
							// Limpiar el paréntesis de origen que añade Google Tasks de forma automática
							let tituloGoogleLimpio = infoGoogle.title.replace(/\s*\([^)]+\)$/, '').trim();

							// Determinar quién se modificó más tarde basándonos en marcas de tiempo estricta
							const cambioEsMasRecienteEnGoogle = infoGoogle.updated > ultimaModificacionArchivo;

							// 1. Sincronizar Cambios de Estado Remotos (Google -> Obsidian)
							if (infoGoogle.completed && !completadaEnObsidian) {
								lineas[i] = `${sangria}- [x] ${textoCrudo}`;
								huboCambiosEnMarkdown = true;
								tareasActualizadasInObsidian++;
							} 
							else if (!infoGoogle.completed && completadaEnObsidian) {
								lineas[i] = `${sangria}- [ ] ${textoCrudo}`;
								huboCambiosEnMarkdown = true;
								tareasActualizadasInObsidian++;
							}
							// 2. Sincronizar Cambios de Texto o Fecha Basados en Prioridad Temporal
							else if (cambioEsMasRecienteEnGoogle) {
								// Google gana: Actualizamos Obsidian con lo que hay en la nube
								let textoReconstruido = tituloGoogleLimpio;
								if (prioridadStr) textoReconstruido += ` ${prioridadStr}`;
								if (infoGoogle.due) textoReconstruido += ` 📅 ${infoGoogle.due}`;
								
								const lineaNuevaGoogle = `${sangria}- [${estadoChar}] ${textoReconstruido} ^${hashDetectado}`;
								
								if (lineas[i].trim() !== lineaNuevaGoogle.trim()) {
									lineas[i] = lineaNuevaGoogle;
									huboCambiosEnMarkdown = true;
									tareasActualizadasInObsidian++;
								}
							} 
							else {
								// Obsidian gana: Se modificó de forma local más tarde, o están sincronizados. Subimos cambio.
								const tituloFinalGoogle = `${tituloLimpioObsidian} (${archivo.basename})`;
								
								// Verificamos si realmente difieren los datos antes de hacer llamadas de red innecesarias
								if (tituloGoogleLimpio !== tituloLimpioObsidian || infoGoogle.due !== fechaISOObsidian) {
									await this.api.actualizarTarea(infoGoogle.listId, infoGoogle.googleId, tituloFinalGoogle, completadaEnObsidian, fechaISOObsidian, hashDetectado);
									tareasActualizadasInCloud++;
								}
							}
						} else if (!completadaEnObsidian) {
							colaTareasNuevas.push({
								i,
								hash: hashDetectado,
								titulo: tituloLimpioObsidian,
								fecha: fechaISOObsidian,
								sangria: sangria
							});
						}
						continue;
					}

					if (completadaEnObsidian) continue;

					const semillaAleatoria = (Date.now() + Math.random() + i).toString();
					const hashUnico = Math.abs(this.generarHashCorto(semillaAleatoria)).toString(36).substring(0, 8);

					lineas[i] = `${sangria}- [ ] ${textoCrudo} ^${hashUnico}`;
					huboCambiosEnMarkdown = true;

					colaTareasNuevas.push({
						i,
						hash: hashUnico,
						titulo: tituloLimpioObsidian,
						fecha: fechaISOObsidian,
						sangria: sangria
					});
				}

				if (huboCambiosEnMarkdown) {
					await this.app.vault.modify(archivo, lineas.join('\n'));
				}

				for (const tarea of colaTareasNuevas) {
					let idPadreGoogle: string | undefined = undefined;
					
					if (tarea.sangria.length > 0 && tarea.i > 0) {
						const lineaAnterior = lineas[tarea.i - 1];
						const matchHashAnterior = lineaAnterior.match(/\^([a-z0-9]{5,8})/);
						if (matchHashAnterior) {
							const infoPadre = mapaHashGoogle.get(matchHashAnterior[1]);
							if (infoPadre) idPadreGoogle = infoPadre.googleId;
						}
					}

					const tituloFinalGoogle = `${tarea.titulo} (${archivo.basename})`;
					const googleId = await this.api.crearTarea(listaDestino.id, tituloFinalGoogle, false, tarea.fecha, idPadreGoogle, tarea.hash);

					if (googleId) {
						mapaHashGoogle.set(tarea.hash, { googleId, listId: listaDestino.id, title: tituloFinalGoogle, completed: false, due: tarea.fecha, updated: Date.now() });
						tareasCreadas++;
					}
				}
			}

			await this.saveSettings();
			
			if (tareasCreadas > 0 || tareasActualizadasInCloud > 0 || tareasActualizadasInObsidian > 0) {
				new Notice(`Sincro Realizada. Creadas: ${tareasCreadas} | Actualizadas en Google: ${tareasActualizadasInCloud} | Traídas a Obsidian: ${tareasActualizadasInObsidian}`);
			}

		} catch (error) {
			console.error('Error crítico en el motor de sincronización:', error);
		} finally {
			this.estaSincronizando = false;
		}
	}
}

class GoogleTasksSyncroSettingTab extends PluginSettingTab {
	plugin: GoogleTasksSyncro;

	constructor(app: App, plugin: GoogleTasksSyncro) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: 'Configuración de Google Tasks Syncro' });

		new Setting(containerEl)
			.setName('Client ID de Google Cloud')
			.addText(text => text.setValue(this.plugin.settings?.clientId || '').onChange(async (value) => { 
				this.plugin.settings.clientId = value.trim(); 
				await this.plugin.saveSettings(); 
			}));

		new Setting(containerEl)
			.setName('Client Secret de Google Cloud')
			.addText(text => text.setValue(this.plugin.settings?.clientSecret || '').onChange(async (value) => { 
				this.plugin.settings.clientSecret = value.trim(); 
				await this.plugin.saveSettings(); 
			}));

		new Setting(containerEl)
			.setName('Lista por defecto (Inbox)')
			.setDesc('Lista de Google donde van las tareas si la carpeta de la nota no coincide con ninguna lista real.')
			.addText(text => text.setValue(this.plugin.settings?.defaultListName || 'Inbox').onChange(async (value) => { 
				this.plugin.settings.defaultListName = value.trim(); 
				await this.plugin.saveSettings(); 
			}));

		new Setting(containerEl)
			.setName('Intervalo de sincronización (minutos)')
			.setDesc('Cada cuántos minutos se ejecuta el escáner de fondo. Configura 0 para usar exclusivamente el botón manual.')
			.addText(text => text.setValue(String(this.plugin.settings?.intervaloSincronizacion ?? 15)).onChange(async (value) => { 
				this.plugin.settings.intervaloSincronizacion = Number(value) || 0; 
				await this.plugin.saveSettings();
				this.plugin.configurarTemporizador();
			}));

		new Setting(containerEl)
			.setName('Carpetas excluidas')
			.setDesc('Lista separada por comas de carpetas cuyas notas no se leerán jamás (ej. Plantillas, Archivo).')
			.addText(text => text.setValue(this.plugin.settings?.carpetasExcluidas.join(', ') || '').onChange(async (value) => { 
				this.plugin.settings.carpetasExcluidas = value.split(',').map(s => s.trim()); 
				await this.plugin.saveSettings(); 
			}));
	}
}