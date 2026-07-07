import { useEffect, useState } from 'react';
import { commissionRuleApiService, type CommissionRuleWithCount } from '../../services/commissionRule.service';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { TruncatedText } from '../../components/ui/TruncatedText';
import type { CommissionRuleConfig } from '@shared/types';
import { CommissionRuleType } from '@shared/types';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { CommissionWizard } from '../../components/commissions/CommissionWizard';

type FilterTab = 'active' | 'archived';

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
                {formatEur(tier.min)} {'\u2192'} {tier.max ? formatEur(tier.max) : '\u221E'}
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
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [filterTab, setFilterTab] = useState<FilterTab>('active');

  // Wizard state
  const [showWizard, setShowWizard] = useState(false);
  const [editingRule, setEditingRule] = useState<CommissionRuleWithCount | null>(null);
  const [successRule, setSuccessRule] = useState<CommissionRuleWithCount | null>(null);

  const loadRules = async () => {
    try {
      const data = await commissionRuleApiService.getAll();
      setRules(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadRules(); }, []);

  const handleCreateClick = () => {
    setEditingRule(null);
    setSuccessRule(null);
    setShowWizard(true);
  };

  const handleEditClick = (rule: CommissionRuleWithCount) => {
    setEditingRule(rule);
    setSuccessRule(null);
    setShowWizard(true);
  };

  const handleWizardCancel = () => {
    setShowWizard(false);
    setEditingRule(null);
  };

  const handleWizardSuccess = (rule: CommissionRuleWithCount) => {
    setShowWizard(false);
    setEditingRule(null);
    setSuccessRule(rule);
    void loadRules();
  };

  const handleArchive = async (ruleId: string) => {
    setArchivingId(ruleId);
    try {
      await commissionRuleApiService.archive(ruleId);
      await loadRules();
      if (successRule?.id === ruleId) setSuccessRule(null);
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

  const filteredRules = rules.filter((r) =>
    filterTab === 'active' ? !r.isArchived : r.isArchived,
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Règles de commission</h1>
          <p className="text-gray-500 mt-1">Gérez votre bibliothèque de règles et assignez-les à vos commerciaux</p>
        </div>
        {!showWizard && (
          <Button onClick={handleCreateClick}>
            <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Nouvelle règle
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">

        {/* ── Colonne gauche : bibliothèque ── */}
        <div className="lg:col-span-2 space-y-4">

          {/* Onglets filtre */}
          <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
            {([['active', 'Actives'], ['archived', 'Archivées']] as [FilterTab, string][]).map(
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
                  <span className="ml-1 text-gray-400">
                    ({tab === 'active' ? rules.filter((r) => !r.isArchived).length : rules.filter((r) => r.isArchived).length})
                  </span>
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
                <p className="text-xs text-gray-300 mt-1">Cliquez sur "Nouvelle règle" pour commencer</p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {filteredRules.map((rule) => (
                <Card key={rule.id} padding="sm" className={rule.isArchived ? 'opacity-60' : ''}>
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <TruncatedText text={rule.name} className="font-medium text-gray-900 text-sm" />
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
                      {rule.paymentDelayDays && (
                        <Badge variant="orange">Paiement +{rule.paymentDelayDays}j</Badge>
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
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleEditClick(rule)}
                          >
                            Modifier
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void handleArchive(rule.id)}
                            loading={archivingId === rule.id}
                            className="text-red-500 hover:text-red-600 hover:bg-red-50"
                          >
                            Archiver
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* ── Colonne droite : wizard ou message d'accueil ── */}
        <div className="lg:col-span-3 space-y-4">
          {showWizard ? (
            <Card>
              <div className="flex items-center gap-2 mb-5">
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${editingRule ? 'bg-amber-100' : 'bg-primary-100'}`}>
                  {editingRule ? (
                    <svg className="w-4 h-4 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                  )}
                </div>
                <h2 className="text-base font-semibold text-gray-900">
                  {editingRule ? `Modifier \u00AB ${editingRule.name} \u00BB` : 'Nouvelle règle de commission'}
                </h2>
              </div>
              <CommissionWizard
                key={editingRule?.id ?? 'new'}
                existingRule={editingRule ?? undefined}
                onSuccess={handleWizardSuccess}
                onCancel={handleWizardCancel}
              />
            </Card>
          ) : successRule ? (
            <Card className="border-green-200 bg-green-50">
              <div className="flex items-center gap-2 mb-3">
                <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <h3 className="font-semibold text-green-800">Règle ajoutée à votre bibliothèque</h3>
              </div>
              <div className="bg-white rounded-lg p-3 border border-green-100">
                <div className="flex items-center gap-2 mb-1">
                  <p className="font-medium text-gray-900">{successRule.name}</p>
                  {ruleTypeBadge(successRule.type)}
                  {successRule.dealType && <Badge variant="yellow">{successRule.dealType}</Badge>}
                </div>
                <RuleConfigDisplay config={successRule.config as unknown as CommissionRuleConfig} />
              </div>
              <p className="text-xs text-green-700 mt-3">
                La règle est disponible dans votre bibliothèque. Assignez-la à vos commerciaux depuis la page <strong>Mon équipe</strong>.
              </p>
              <div className="mt-3">
                <Button size="sm" onClick={handleCreateClick}>Créer une autre règle</Button>
              </div>
            </Card>
          ) : (
            <Card className="border-dashed border-2 border-gray-200 bg-gray-50">
              <div className="text-center py-8">
                <div className="w-12 h-12 bg-primary-100 rounded-xl flex items-center justify-center mx-auto mb-4">
                  <svg className="w-6 h-6 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                <h3 className="text-sm font-semibold text-gray-700 mb-1">Créez vos règles de commission</h3>
                <p className="text-xs text-gray-400 max-w-xs mx-auto">
                  Définissez des règles de type pourcentage, montant fixe ou paliers progressifs, puis assignez-les à vos commerciaux.
                </p>
                <Button onClick={handleCreateClick} className="mt-4">
                  Commencer
                </Button>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
