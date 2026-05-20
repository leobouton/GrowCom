import { api } from './api';
import type { ImportPreview, FileImportConfirmResult, ImportLog } from '@shared/types';

export const fileImportApiService = {
  /**
   * Upload + prévisualisation (étape 1)
   */
  async upload(file: File): Promise<ImportPreview> {
    const formData = new FormData();
    formData.append('file', file);
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
