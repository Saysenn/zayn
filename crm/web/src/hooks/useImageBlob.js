import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

/**
 * A PICTURE FROM THE API, AS SOMETHING AN <img> CAN SHOW.
 *
 * The API sits on another port and needs the sign-in cookie, which a bare
 * <img src> does not send. So it is fetched with credentials as a blob and
 * shown through an object URL, freed when nothing shows it any more.
 *
 * @param {string[]} key     react-query key; the blob is cached under it
 * @param {() => Promise<{ blob: Blob }>} fetchBlob
 * @returns {{ url: string|null, isLoading: boolean, isError: boolean }}
 */
export function useImageBlob(key, fetchBlob, { enabled = true } = {}) {
  const { data, isLoading, isError } = useQuery({
    queryKey: key, queryFn: fetchBlob, enabled, staleTime: Infinity, gcTime: 30 * 60 * 1000,
  });
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!data?.blob) return undefined;
    const u = URL.createObjectURL(data.blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [data]);
  return { url, isLoading, isError };
}
