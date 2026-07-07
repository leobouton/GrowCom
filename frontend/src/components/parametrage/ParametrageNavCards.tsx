interface NavCardProps {
  icon: string;
  title: string;
  description: string;
  count: number;
  countLabel: string;
  isActive: boolean;
  onClick: () => void;
}

function NavCard({ icon, title, description, count, countLabel, isActive, onClick }: NavCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-start text-left p-5 rounded-2xl border-2 transition-all duration-200 cursor-pointer group ${
        isActive
          ? 'border-primary-500 bg-primary-50 shadow-sm shadow-primary-100'
          : 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm'
      }`}
    >
      <span className="text-2xl mb-3">{icon}</span>
      <p className={`text-sm font-semibold mb-1 ${isActive ? 'text-primary-700' : 'text-gray-900'}`}>
        {title}
      </p>
      <p className="text-xs text-gray-400 leading-relaxed mb-4">{description}</p>
      <div className="mt-auto w-full flex items-center justify-between">
        <span className={`text-xs font-medium ${isActive ? 'text-primary-600' : 'text-gray-500'}`}>
          {count} {countLabel}
        </span>
        <span className={`text-xs font-medium transition-colors ${
          isActive ? 'text-primary-600' : 'text-gray-400 group-hover:text-gray-600'
        }`}>
          Gérer &rarr;
        </span>
      </div>
    </button>
  );
}

// « Plan de variable » unifie les anciens onglets « Commissions » et « Objectifs »
export type ParametrageTab = 'plan' | 'concours';

interface ParametrageNavCardsProps {
  activeTab: ParametrageTab;
  onTabChange: (tab: ParametrageTab) => void;
  commissionsCount: number;
  objectifsCount: number;
  concoursCount: number;
}

export function ParametrageNavCards({
  activeTab,
  onTabChange,
  commissionsCount,
  objectifsCount,
  concoursCount,
}: ParametrageNavCardsProps) {
  const cards: { tab: ParametrageTab; icon: string; title: string; description: string; count: number; countLabel: string }[] = [
    {
      tab: 'plan',
      icon: '📋',
      title: 'Plan de variable',
      description: 'Commissions et objectifs, décrits en une phrase et vérifiés par simulation',
      count: commissionsCount + objectifsCount,
      countLabel: 'élément(s) actif(s)',
    },
    {
      tab: 'concours',
      icon: '🏆',
      title: 'Concours',
      description: 'Challenges ponctuels avec lots',
      count: concoursCount,
      countLabel: 'en cours',
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {cards.map((card) => (
        <NavCard
          key={card.tab}
          icon={card.icon}
          title={card.title}
          description={card.description}
          count={card.count}
          countLabel={card.countLabel}
          isActive={activeTab === card.tab}
          onClick={() => onTabChange(card.tab)}
        />
      ))}
    </div>
  );
}
