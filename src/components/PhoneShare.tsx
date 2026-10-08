import { useEffect, useRef, useState } from 'react';

export function PhoneShare() {
  const [url, setUrl] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    let stop = false;
    fetch('/dev-share')
      .then(async (res) => {
        if (!res.ok || stop) return;
        const data = await res.json() as { url?: string; qr?: string | null };
        if (data.url) {
          setUrl(data.url);
          setQr(data.qr ?? null);
        }
      })
      .catch(() => {});
    return () => { stop = true; };
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  if (!import.meta.env.DEV || !url) return null;

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        className={`px-2 py-1 text-xs rounded border transition-colors ${
          open
            ? 'border-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-400'
            : 'border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-800'
        }`}
        title="Show the phone link"
      >
        Phone
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-2 w-64 rounded-xl border border-gray-200 bg-white p-3 text-gray-800 shadow-xl dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100">
          {qr && <img src={qr} alt="" className="mx-auto h-52 w-52 rounded bg-white" />}
          <p className="mt-2 break-all text-center text-xs text-gray-500 dark:text-gray-400">{url}</p>
        </div>
      )}
    </div>
  );
}
