import { api } from './api';

// Résultat d'une synchronisation HubSpot (même forme que la synchro Odoo).
export interface HubspotSyncResult {
  synced: number;
  created: number;
  updated: number;
  errors: string[];
  syncedAt: string;
}

export const hubspotApiService = {
  async getConfig(): Promise<{
    configured: boolean;
    hubspotPortalId: string | null;
  }> {
    const res = await api.get('/hubspot/config');
    return (res.data as { success: true; data: { configured: boolean; hubspotPortalId: string | null } }).data;
  },

  async configure(data: {
    hubspotToken: string;
  }): Promise<{ configured: boolean; hubspotPortalId: string | null }> {
    const res = await api.post('/hubspot/config', data);
    return (res.data as { success: true; data: { configured: boolean; hubspotPortalId: string | null } }).data;
  },

  async sync(): Promise<HubspotSyncResult> {
    const res = await api.post<{ success: true; data: HubspotSyncResult }>('/hubspot/sync');
    return res.data.data;
  },
};
