import { useState } from 'react';
import { payrollReportService } from '../../services/payrollReport.service';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import type { PayrollReportPreview } from '@shared/types';

const MONTHS = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];

function formatEur(amount: number) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(amount);
}

export function ReportsPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [preview, setPreview] = useState<PayrollReportPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const yearOptions = [now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2];

  const handlePreview = async () => {
    setPreviewLoading(true);
    setError(null);
    try {
      const data = await payrollReportService.preview(year, month);
      setPreview(data);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setError(e?.response?.data?.message ?? 'Impossible de charger la prévisualisation.');
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleDownload = async () => {
    setPdfLoading(true);
    setError(null);
    try {
      await payrollReportService.downloadPdf(year, month);
    } catch (err: unknown) {
      const e = err as { message?: string };
      setError(e?.message ?? 'Impossible de télécharger le PDF.');
    } finally {
      setPdfLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Rapports de paie</h1>
        <p className="text-gray-500 mt-1">Générez les fiches de synthèse mensuelles pour la paie</p>
      </div>

      {/* Sélecteur de période */}
      <Card>
        <h2 className="text-base font-semibold text-gray-900 mb-4">Période</h2>
        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Mois</label>
            <select
              value={month}
              onChange={(e) => { setMonth(parseInt(e.target.value, 10)); setPreview(null); }}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              {MONTHS.map((name, i) => (
                <option key={i + 1} value={i + 1}>{name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Année</label>
            <select
              value={year}
              onChange={(e) => { setYear(parseInt(e.target.value, 10)); setPreview(null); }}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-3">
            <Button
              variant="secondary"
              loading={previewLoading}
              onClick={() => void handlePreview()}
            >
              <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
              Prévisualiser
            </Button>
            <Button
              loading={pdfLoading}
              onClick={() => void handleDownload()}
            >
              <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Télécharger PDF
            </Button>
          </div>
        </div>
        {error && (
          <p className="text-xs text-red-600 mt-3">{error}</p>
        )}
      </Card>

      {/* Prévisualisation */}
      {preview && (
        <div className="space-y-4">
          {/* Résumé global */}
          <Card>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-gray-900">
                Synthèse — {MONTHS[month - 1]} {year}
              </h2>
              <div className="text-right">
                <p className="text-xs text-gray-400">{preview.items.length} commercial{preview.items.length > 1 ? 'aux' : ''}</p>
                <p className="text-lg font-bold text-gray-900">{formatEur(preview.grandTotal)}</p>
                <p className="text-xs text-gray-400">masse salariale totale</p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-xs text-gray-400 mb-1">Salaires fixes</p>
                <p className="font-semibold text-gray-900">{formatEur(preview.items.reduce((s, i) => s + i.fixedSalaryTotal, 0))}</p>
              </div>
              <div className="bg-green-50 rounded-xl p-3">
                <p className="text-xs text-gray-400 mb-1">Commissions</p>
                <p className="font-semibold text-gray-900">{formatEur(preview.items.reduce((s, i) => s + i.commissionsTotal, 0))}</p>
              </div>
              <div className="bg-blue-50 rounded-xl p-3">
                <p className="text-xs text-gray-400 mb-1">Primes + ajustements</p>
                <p className="font-semibold text-gray-900">{formatEur(preview.items.reduce((s, i) => s + i.bonusTotal + i.adjustmentsTotal, 0))}</p>
              </div>
            </div>
          </Card>

          {/* Détail par commercial */}
          {preview.items.map((item) => (
            <Card key={item.userId}>
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="font-semibold text-gray-900">{item.user.firstName} {item.user.lastName}</p>
                  <p className="text-xs text-gray-400">{item.user.email}</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold text-primary-700">{formatEur(item.netTotal)}</p>
                  <p className="text-xs text-gray-400">total brut</p>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                <div className="bg-gray-50 rounded-lg px-3 py-2">
                  <p className="text-xs text-gray-400">Fixe</p>
                  <p className="font-medium text-gray-800">{formatEur(item.fixedSalaryTotal)}</p>
                </div>
                <div className="bg-green-50 rounded-lg px-3 py-2">
                  <p className="text-xs text-gray-400">Commissions</p>
                  <p className="font-medium text-gray-800">{formatEur(item.commissionsTotal)}</p>
                </div>
                <div className="bg-amber-50 rounded-lg px-3 py-2">
                  <p className="text-xs text-gray-400">Primes objectifs</p>
                  <p className="font-medium text-gray-800">{formatEur(item.bonusTotal)}</p>
                </div>
                <div className={`rounded-lg px-3 py-2 ${item.adjustmentsTotal < 0 ? 'bg-red-50' : 'bg-blue-50'}`}>
                  <p className="text-xs text-gray-400">Ajustements</p>
                  <p className={`font-medium ${item.adjustmentsTotal < 0 ? 'text-red-700' : 'text-gray-800'}`}>
                    {item.adjustmentsTotal > 0 ? '+' : ''}{formatEur(item.adjustmentsTotal)}
                  </p>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
