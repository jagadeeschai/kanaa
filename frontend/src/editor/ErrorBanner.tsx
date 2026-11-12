import { useState } from 'react';
import { X } from 'lucide-react';
import { t } from '../i18n';
import { explainError } from './errors';

/** The editor's one error banner: plain words, the original under Details when it was technical. */
export default function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  const [open, setOpen] = useState(false);
  const { text, details } = explainError(message);
  return <div className="ed-error" role="alert"><span>{text}{details && <>{' '}<button className="ed-link" onClick={() => setOpen(!open)}>{t(open ? 'Hide details' : 'Details')}</button>{open && <small className="ed-error-details">{details}</small>}</>}</span>
    <button aria-label={t('Dismiss')} onClick={onDismiss}><X size={15}/></button></div>;
}

