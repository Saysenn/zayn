import { apiService } from '../../../configs/api.config';
import { useImageBlob } from '../../../hooks/useImageBlob';

/**
 * THE EXPENSE PICTURE IN DIANE'S CHAT: the same note WhatsApp gets, in the
 * style picked in Settings → Whatbot, under her card. Click to open it large.
 * The chat keeps only the id; the picture itself is kept in the CRM.
 */
export function useAgentImage(id) {
  return useImageBlob(['agent-image', id], () => apiService.agentImages.get(id), { enabled: Boolean(id) });
}

export default function ExpenseImage({ image, onOpen }) {
  const { url, isError } = useAgentImage(image.id);
  return (
    <button
      type="button"
      onClick={() => onOpen?.(image)}
      disabled={!url}
      title="Open the picture"
      className="group block w-full max-w-[420px] min-h-0 overflow-hidden rounded-lg border border-diane-line/35 bg-diane-sunken/60 p-0 text-left hover:border-diane-signal/60"
    >
      {isError ? (
        <span className="block px-3 py-2 text-[11px] text-white/50">This picture is no longer available.</span>
      ) : url ? (
        <img src={url} alt={image.caption || 'Expense picture'} className="block max-h-64 w-full object-cover object-top" />
      ) : (
        <span className="block h-40 w-full animate-pulse bg-diane-line/10" />
      )}
      <span className="flex items-center justify-between px-3 py-1.5 text-[10px] text-white/50 group-hover:text-white/80">
        <span>{image.caption}</span>
        <span>Click to open</span>
      </span>
    </button>
  );
}
