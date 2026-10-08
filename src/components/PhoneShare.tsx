import { useEffect, useState } from 'react';
import { QrCode, X } from 'lucide-react';

export function PhoneShare() {
  const [url, setUrl] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [open, setOpen] = useState(true);

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

  if (!import.meta.env.DEV || !url) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-lg"
      >
        <QrCode size={16} />
        Phone
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 w-72 rounded-xl bg-white p-4 text-gray-800 shadow-2xl dark:bg-gray-800 dark:text-gray-100">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium">Open on your phone</span>
        <button type="button" onClick={() => setOpen(false)} className="text-gray-500 hover:text-gray-800 dark:hover:text-white" aria-label="Hide phone code">
          <X size={16} />
        </button>
      </div>
      {qr && <img src={qr} alt="" className="mx-auto h-56 w-56 rounded bg-white" />}
      <p className="mt-2 break-all text-center text-xs text-gray-500 dark:text-gray-400">{url}</p>
    </div>
  );
}
