import { api } from './api';
import type { ImportPreview, FileImportConfirmResult, ImportLog } from '@shared/types';

export const fileImportApiService = {
  /**
   * Upload + prévisualisation (étape 1)
   * Si customMapping est fourni, le backend utilise ces correspondances manuelles.
   */
  async upload(file: File, customMapping?: Record<string, string>): Promise<ImportPreview> {
    const formData = new FormData();
    formData.append('file', file);
    if (customMapping) {
      formData.append('customMapping', JSON.stringify(customMapping));
    }
    const res = await api.post<{ success: true; data: ImportPreview }>(
      '/sync/upload',
      formData,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    );
    return res.data.data;
  },

  /**
   * Confirmation de l'import (étape 2)
   */
  async confirm(importLogId: string): Promise<FileImportConfirmResult> {
    const res = await api.post<{ success: true; data: FileImportConfirmResult }>(
      '/sync/confirm',
      { importLogId },
    );
    return res.data.data;
  },

  /**
   * Historique des 5 derniers imports
   */
  async history(): Promise<ImportLog[]> {
    const res = await api.get<{ success: true; data: ImportLog[] }>('/sync/history');
    return res.data.data;
  },
};
