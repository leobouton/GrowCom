import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import axios from 'axios';
import { commissionRuleApiService, type CommissionRuleWithCount } from '../../services/commissionRule.service';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Input } from '../../components/ui/Input';
import type { CommissionRuleConfig } from '@shared/types';
import { CommissionRuleType } from '@shared/types';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

const schema = z.object({
  name: z.string().min(1, 'Le nom est requis'),
  dealType: z.string().max(50).optional(),
  description: z
    .string()
    .min(10, 'Décrivez la règle en au moins 10 caractères')
    .max(1000),
});

type FormData = z.infer<typeof schema>;

type FilterTab = 'all' | 'active' | 'archived';

function formatEur(amount: number) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(amount);
}

function ruleTypeBadge(type: string) {
  const map: Record<string, { label: string; variant: 'blue' | 'indigo' | 'purple' }> = {
    PERCENTAGE: { label: 'Pourcentage', variant: 'blue' },
    FIXED: { label: 'Fixe', variant: 'indigo' },
    TIERED: { label: 'Paliers', variant: 'purple' },
  };
  const c = map[type] ?? { label: type, variant: 'blue' };
  return <Badge variant={c.variant}>{c.label}</Badge>;
}

function RuleConfigDisplay({ config }: { config: CommissionRuleConfig }) {
  return (
    <div className="mt-2 space-y-2">
      <p className="text-sm text-gray-500">{config.description}</p>

      {config.type === CommissionRuleType.PERCENTAGE && config.rate !== undefined && (
        <p className="text-sm font-semibold text-primary-700">{(config.rate * 100).toFixed(0)}% du montant</p>
      )}

      {config.type === CommissionRuleType.FIXED && config.fixedAmount !== undefined && (
        <p className="text-sm font-semibold text-primary-700">{formatEur(config.fixedAmount)} fixe</p>
      )}

      {config.tiers && config.tiers.length > 0 && (
        <div className="space-y-1">
          {config.tiers.map((tier, i) => (
            <div key={i} className="flex items-center gap-2 text-xs bg-gray-50 rounded px-2 py-1">
              <span className="text-gray-500">
                {formatEur(tier.min)} → {tier.max ? formatEur(tier.max) : '∞'}
              </span>
              <span className="font-semibold text-primary-700">{(tier.rate * 100).toFixed(0)}%</span>
            </div>
          ))}
        </div>
      )}

      {config.examples && config.examples.length > 0 && (
        <p className="text-xs text-gray-400 italic">{config.examples[0].explanation}</p>
      )}
    </div>
  );
}

export function CommissionRulesPage() {
  const [rules, setRules] = useState<CommissionRuleWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [generatedRule, setGeneratedRule] = useState<CommissionRuleWithCount | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filterTab, setFilterTab] = useState<FilterTab>('active');

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const loadRules = async () => {
    try {
      const data = await commissionRuleApiService.getAll();
      setRules(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadRules(); }, []);

  const onSubmit = async (data: FormData) => {
    setError(null);
    setGenerating(true);
    setGeneratedRule(null);
    try {
      const rule = await commissionRuleApiService.generate({
        name: data.name,
        description: data.description,
        dealType: data.dealType || null,
      });
      const ruleWithCount: CommissionRuleWithCount = { ...rule, assignmentCount: 0 };
      setGeneratedRule(ruleWithCount);
      await loadRules();
      reset();
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        const status = err.response?.status;
        const apiMsg = (err.response?.data as { error?: { message?: string } } | undefined)?.error?.message;
        setError(`[${status ?? '?'}] ${apiMsg ?? err.message}`);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Erreur inconnue');
      }
    } finally {
      setGenerating(false);
    }
  };

  const handleArchive = async (ruleId: string) => {
    setArchivingId(ruleId);
    try {
      await commissionRuleApiService.archive(ruleId);
      await loadRules();
      if (generatedRule?.id === ruleId) setGeneratedRule(null);
    } finally {
      setArchivingId(null);
    }
  };

  const handleUnarchive = async (ruleId: string) => {
    setArchivingId(ruleId);
    try {
      await commissionRuleApiService.unarchive(ruleId);
      await loadRules();
    } finally {
      setArchivingId(null);
    }
  };

  const filteredRules = rules.filter((r) => {
    if (filterTab === 'active') return !r.isArchived;
    if (filterTab === 'archived') return r.isArchived;
    return true;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Règles de commission</h1>
        <p className="text-gray-500 mt-1">Gérez votre bibliothèque de règles et assignez-les à vos commerciaux</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">

        {/* ── Colonne gauche : bibliothèque ── */}
        <div className="lg:col-span-2 space-y-4">

          {/* Onglets filtre */}
          <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
            {([['all', 'Toutes'], ['active', 'Actives'], ['archived', 'Archivées']] as [FilterTab, string][]).map(
              ([tab, label]) => (
                <button
                  key={tab}
                  onClick={() => setFilterTab(tab)}
                  className={`flex-1 text-xs font-medium py-1.5 rounded-md transition-colors ${
                    filterTab === tab
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {label}
                  {tab !== 'archived' && (
                    <span className="ml-1 text-gray-400">
                      ({tab === 'all' ? rules.length : rules.filter((r) => !r.isArchived).length})
                    </span>
                  )}
                </button>
              ),
            )}
          </div>

          {/* Liste des règles */}
          {filteredRules.length === 0 ? (
            <div className="border-2 border-dashed border-gray-200 rounded-xl p-8 text-center">
              <p className="text-sm text-gray-400">
                {filterTab === 'archived' ? 'Aucune règle archivée' : 'Aucune règle créée'}
              </p>
              {filterTab !== 'archived' && (
                <p className="text-xs text-gray-300 mt-1">Utilisez le formulaire pour générer votre première règle</p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {filteredRules.map((rule) => (
                <Card key={rule.id} padding="sm" className={rule.isArchived ? 'opacity-60' : ''}>
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 text-sm truncate">{rule.name}</p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {format(new Date(rule.createdAt), 'dd MMM yyyy', { locale: fr })}
                        </p>
                      </div>
                      {rule.isArchived && <Badge variant="gray">Archivée</Badge>}
                    </div>

                    <div className="flex flex-wrap gap-1">
                      {ruleTypeBadge(rule.type)}
                      {rule.dealType && (
                        <Badge variant="yellow">{rule.dealType}</Badge>
                      )}
                    </div>

                    {!rule.isArchived && (
                      <p className="text-xs text-gray-400">
                        {rule.assignmentCount > 0
                          ? `${rule.assignmentCount} assignation${rule.assignmentCount > 1 ? 's' : ''} active${rule.assignmentCount > 1 ? 's' : ''}`
                          : 'Aucune assignation'}
                      </p>
                    )}

                    <RuleConfigDisplay config={rule.config as unknown as CommissionRuleConfig} />

                    <div className="flex gap-2 pt-1">
                      {rule.isArchived ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void handleUnarchive(rule.id)}
                          loading={archivingId === rule.id}
                        >
                          Restaurer
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void handleArchive(rule.id)}
                          loading={archivingId === rule.id}
                          className="text-red-500 hover:text-red-600 hover:bg-red-50"
                        >
                          Archiver
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* ── Colonne droite : créer une règle ── */}
        <div className="lg:col-span-3 space-y-4">
          <Card>
            <div className="flex items-center gap-2 mb-5">
              <div className="w-7 h-7 bg-primary-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <svg className="w-4 h-4 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <h2 className="text-base font-semibold text-gray-900">Créer une nouvelle règle</h2>
            </div>

            <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} className="space-y-4">
              <Input
                label="Nom de la règle"
                placeholder="Ex : Commission CDI Senior"
                error={errors.name?.message}
                {...register('name')}
              />

              <Input
                label="Type de deal concerné (optionnel)"
                placeholder="Ex : CDI, CDD, Intérim, Placement..."
                error={errors.dealType?.message}
                hint="Laissez vide pour une règle applicable à tous les deals"
                {...register('dealType')}
              />

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Décrivez votre règle de commission
                </label>
                <textarea
                  className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 resize-none"
                  rows={5}
                  placeholder="Ex : 10% sur toutes les ventes, 15% au-dessus de 10 000€ de CA mensuel, avec un palier à 20% au-dessus de 25 000€..."
                  {...register('description')}
                />
                {errors.description && (
                  <p className="mt-1 text-xs text-red-600">{errors.description.message}</p>
                )}
              </div>

              {error && (
                <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3">
                  <p className="text-sm text-red-600">{error}</p>
                </div>
              )}

              <Button type="submit" loading={generating} className="w-full">
                {generating ? 'Génération en cours...' : 'Générer avec l\'IA'}
              </Button>
            </form>
          </Card>

          {/* Règle générée */}
          {generatedRule && (
            <Card className="border-green-200 bg-green-50">
              <div className="flex items-center gap-2 mb-3">
                <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <h3 className="font-semibold text-green-800">Règle ajoutée à votre bibliothèque</h3>
              </div>
              <div className="bg-white rounded-lg p-3 border border-green-100">
                <div className="flex items-center gap-2 mb-1">
                  <p className="font-medium text-gray-900">{generatedRule.name}</p>
                  {ruleTypeBadge(generatedRule.type)}
                  {generatedRule.dealType && <Badge variant="yellow">{generatedRule.dealType}</Badge>}
                </div>
                <RuleConfigDisplay config={generatedRule.config as unknown as CommissionRuleConfig} />
              </div>
              <p className="text-xs text-green-700 mt-3">
                La règle est disponible dans votre bibliothèque. Assignez-la à vos commerciaux depuis la page <strong>Mon équipe</strong>.
              </p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
