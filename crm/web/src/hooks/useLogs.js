import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiService } from '../configs/api.config';

// Logs are a debugging aid, not an event stream worth a socket channel —
// short polling keeps the page feeling live without adding one.
export function useLogs({ source, level, page = 1, pageSize = 20 } = {}) {
  const query = useQuery({
    queryKey: ['logs', source ?? 'all', level ?? 'all', page, pageSize],
    queryFn: () => apiService.logs.list({ source, level, page, pageSize }),
    select: (data) => ({ rows: data.logs, total: data.total }),
    placeholderData: (prev) => prev,
    refetchInterval: 5000,
  });

  return { ...query, data: query.data?.rows, total: query.data?.total ?? 0 };
}

// Deletes whatever the current source/level filter matches — never "all
// logs" by accident, since the same filter driving the table drives the
// delete. Not a plain useMutation: the backend deletes one batch per call
// (logs.repo.js's deleteBatch), so this loops it and reports a real 0-100%
// against the count fetched up front, rather than an indeterminate spinner.
export function useClearLogs() {
  const queryClient = useQueryClient();
  const [isClearing, setIsClearing] = useState(false);
  const [progress, setProgress] = useState(0);

  async function clear({ source, level }) {
    setIsClearing(true);
    setProgress(0);
    try {
      const { count: total } = await apiService.logs.count({ source, level });
      if (total === 0) {
        setProgress(100);
        return;
      }
      let remaining = total;
      while (remaining > 0) {
        const { deleted } = await apiService.logs.clearBatch({ source, level });
        if (deleted === 0) break; // nothing left to take — avoids spinning forever
        remaining -= deleted;
        setProgress(Math.round(((total - remaining) / total) * 100));
      }
    } finally {
      queryClient.invalidateQueries({ queryKey: ['logs'] });
      setIsClearing(false);
    }
  }

  return { clear, isClearing, progress };
}
