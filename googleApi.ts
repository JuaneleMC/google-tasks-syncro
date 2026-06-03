import { requestUrl } from 'obsidian';
import GoogleTasksSyncro from './main';

export class GoogleTasksApi {
    plugin: GoogleTasksSyncro;

    constructor(plugin: GoogleTasksSyncro) {
        this.plugin = plugin;
    }

    async asegurarToken(): Promise<string> {
        return this.plugin.settings.accessToken;
    }

    async refrescarToken(): Promise<boolean> {
        try {
            const url = 'https://oauth2.googleapis.com/token';
            const payload = {
                client_id: this.plugin.settings.clientId,
                client_secret: this.plugin.settings.clientSecret,
                refresh_token: this.plugin.settings.refreshToken,
                grant_type: 'refresh_token'
            };
            const response = await requestUrl({
                url: url,
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams(payload).toString()
            });

            if (response.status === 200 && response.json) {
                this.plugin.settings.accessToken = response.json.access_token;
                await this.plugin.saveSettings();
                return true;
            }
        } catch (error) {
            console.error('Error al refrescar token:', error);
        }
        return false;
    }

    async obtenerListasTareas(): Promise<any[]> {
        const token = await this.asegurarToken();
        try {
            const response = await requestUrl({
                url: 'https://www.googleapis.com/tasks/v1/users/@me/lists',
                method: 'GET',
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (response.status === 401) {
                const reflejado = await this.refrescarToken();
                if (reflejado) return this.obtenerListasTareas();
            }
            return response.json.items || [];
        } catch (error) {
            console.error('Error obteniendo listas:', error);
            return [];
        }
    }

    async obtenerTareasDeLista(listId: string): Promise<any[]> {
        const token = await this.asegurarToken();
        try {
            const response = await requestUrl({
                url: `https://www.googleapis.com/tasks/v1/lists/${listId}/tasks?showCompleted=true&showHidden=true`,
                method: 'GET',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            return response.json.items || [];
        } catch (error) {
            console.error(`Error obteniendo tareas de la lista ${listId}:`, error);
            return [];
        }
    }

    async crearTarea(listId: string, titulo: string, completada: boolean, fecha?: string, idPadreGoogle?: string, hash?: string): Promise<string | null> {
        const token = await this.asegurarToken();
        try {
            const bodyData: any = {
                title: titulo,
                status: completada ? 'completed' : 'needsAction',
                notes: hash ? `Hash: ^${hash}` : ''
            };
            if (fecha) bodyData.due = `${fecha}T00:00:00.000Z`;
            if (idPadreGoogle) bodyData.parent = idPadreGoogle;

            const response = await requestUrl({
                url: `https://www.googleapis.com/tasks/v1/lists/${listId}/tasks`,
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(bodyData)
            });

            if (response.status === 200 || response.status === 201) {
                return response.json.id;
            }
        } catch (error) {
            console.error('Error creando tarea:', error);
        }
        return null;
    }

    async actualizarTarea(listId: string, googleTaskId: string, titulo: string, completada: boolean, fecha?: string, hash?: string): Promise<void> {
        const token = await this.asegurarToken();
        try {
            const bodyData: any = {
                id: googleTaskId,
                title: titulo,
                status: completada ? 'completed' : 'needsAction',
                notes: hash ? `Hash: ^${hash}` : ''
            };
            if (fecha) bodyData.due = `${fecha}T00:00:00.000Z`;

            await requestUrl({
                url: `https://www.googleapis.com/tasks/v1/lists/${listId}/tasks/${googleTaskId}`,
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(bodyData)
            });
        } catch (error) {
            console.error('Error actualizando tarea:', error);
        }
    }
}