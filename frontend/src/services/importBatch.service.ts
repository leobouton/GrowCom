import { api } from './api';
import type { ImportBatchWithDetails, CancelPreviewResult } from '@shared/types';

interface ImportBatchListResponse {
  batches: ImportBatchWithDetails[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface CancelResult {
  status: 'CANCELLED' | 'PARTIALLY_CANCELLED';
  deletedDeals: number;
  keptDeals: number;
  restoredDeals: number;
  blockedReason?: string;
}

export const importBatchApiService = {
  async list(page = 1, limit = 20): Promise<ImportBatchListResponse> {
    const res = await api.get<{ success: true; data: ImportBatchListResponse }>(
      `/imports?page=${page}&limit=${limit}`,
    );
    return res.data.data;
  },

  async getById(id: string): Promise<ImportBatchWithDetails & { deals: unknown[] }> {
    const res = await api.get<{ success: true; data: ImportBatchWithDetails & { deals: unknown[] } }>(
      `/imports/${id}`,
    );
    return res.data.data;
  },

  async cancelPreview(id: string): Promise<CancelPreviewResult> {
    const res = await api.get<{ success: true; data: CancelPreviewResult }>(
      `/imports/${id}/cancel-preview`,
    );
    return res.data.data;
  },

  async cancel(id: string, reason: string): Promise<CancelResult> {
    const res = await api.post<{ success: true; data: CancelResult }>(
      `/imports/${id}/cancel`,
      { reason },
    );
    return res.data.data;
  },
};
