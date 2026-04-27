import { api } from './api';
import type { OdooSyncResult } from '@shared/types';

export const odooApiService = {
  async getConfig(): Promise<{
    configured: boolean;
    odooUrl: string | null;
    odooDatabase: string | null;
  }> {
    const res = await api.get('/odoo/config');
    return (res.data as { success: true; data: { configured: boolean; odooUrl: string | null; odooDatabase: string | null } }).data;
  },

  async configure(data: {
    odooUrl: string;
    odooDatabase: string;
    odooApiKey: string;
  }): Promise<{ configured: boolean; odooUrl: string; odooDatabase: string }> {
    const res = await api.post('/odoo/config', data);
    return (res.data as { success: true; data: { configured: boolean; odooUrl: string; odooDatabase: string } }).data;
  },

  async sync(): Promise<OdooSyncResult> {
    const res = await api.post<{ success: true; data: OdooSyncResult }>('/odoo/sync');
    return res.data.data;
  },
};
