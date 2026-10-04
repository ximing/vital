import { formatQrLoginPayload, type QrLoginTicket } from '@vital/dto';
import { toString as encodeQrSvg } from 'qrcode';
import { useEffect, useState } from 'react';
import { t } from '@/copy';

export function LoginQr({ ticket }: { ticket: QrLoginTicket | null }) {
  const payload = ticket === null ? null : formatQrLoginPayload(ticket);
  const [encoded, setEncoded] = useState<{ payload: string; svg: string } | null>(null);
  const svg = encoded !== null && encoded.payload === payload ? encoded.svg : null;

  useEffect(() => {
    if (payload === null) return;
    let cancel = false;
    void encodeQrSvg(payload, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })
      .then((raw) => {
        if (cancel) return;
        setEncoded({
          payload,
          svg: raw.replaceAll('#000000', 'currentColor').replaceAll('#ffffff', 'transparent'),
        });
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [payload]);

  return (
    <div
      role="img"
      aria-label={t.auth.qrTitle}
      className="flex h-[196px] w-[196px] items-center justify-center rounded-xl border border-border bg-surface text-fg"
    >
      {svg ? (
        <div
          className="h-[180px] w-[180px] [&_svg]:h-full [&_svg]:w-full"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : null}
    </div>
  );
}
