import { formatMoney, formatMoneyCode } from '../../helpers/formatMoney';

export default function NormalizedMoney({ money, display = 'usd', compact = false, className = '' }) {
  const value = money ?? { native: {}, usd: null, usdPartial: false, missingFx: [] };
  if (display === 'usd') {
    return (
      <div className={className}>
        <div>{value.usd === null ? 'USD unavailable' : `${value.usdPartial ? 'Converted subtotal: ' : ''}${formatMoney(value.usd, 'USD')}`}</div>
        {value.missingFx.length > 0 && (
          <div className={`${compact ? 'mt-0.5' : 'mt-1'} text-xs font-normal text-warning`}>
            {value.usd === null ? 'USD unavailable. ' : 'Converted subtotal excludes '}
            {value.missingFx.join(', ')}
          </div>
        )}
      </div>
    );
  }

  const entries = Object.entries(value.native).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return <span className={className}>Not available</span>;
  return (
    <div className={`${compact ? 'space-y-0.5' : 'space-y-1'} ${className}`}>
      {/* CODE FIRST, EVERY LINE. A stack where one row says £ and the next
          says AED reads as two different kinds of figure. */}
      {entries.map(([currency, amount]) => <div key={currency}>{formatMoneyCode(amount, currency)}</div>)}
    </div>
  );
}
