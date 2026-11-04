import { useEffect, useState } from 'react';
import { getPhoneAccess, newPhonePin, setPhoneAccess, type PhoneAccess } from '../api/client';

/** Turn phone access on, see the address and PIN to use on the phone, or make a new PIN to sign every phone out. */
export default function PhoneAccessFields() {
  const [state, setState] = useState<PhoneAccess | null>(null);
  const [problem, setProblem] = useState('');
  const run = (action: () => Promise<PhoneAccess>) => { setProblem(''); action().then(setState).catch((error: Error) => setProblem(error.message)); };
  useEffect(() => run(getPhoneAccess), []);
  if (!state) return <p className="phone-note">{problem || 'Checking…'}</p>;
  const address = state.address ? `http://${state.address}:${state.port}` : null;
  return <div className="phone-access">
    <label className="phone-switch"><input type="checkbox" checked={state.enabled} onChange={(event) => run(() => setPhoneAccess(event.target.checked))}/>
      <span><b>Let my phone use Kanaa</b><small>Phones and tablets on the same Wi-Fi as this Mac, after entering a PIN. Off, only this Mac can.</small></span></label>
    {state.enabled && <>
      {!state.listening && <p className="phone-warning">Quit Kanaa (⌘Q) and open it again to let your phone in. If your Mac asks whether Python may accept incoming connections, choose Allow.</p>}
      {state.locked && <p className="phone-warning">Too many wrong PINs were tried, so phones are locked out. Make a new PIN to let them in again.</p>}
      <div className="phone-steps">
        <div><small>1. On your phone, open</small><b className="phone-address">{address ?? 'Connect this Mac to Wi-Fi first'}</b></div>
        <div><small>2. Enter this PIN</small><b className="phone-pin">{state.pin}</b></div>
      </div>
      <div className="phone-row"><span>{state.phones ? `${state.phones} ${state.phones === 1 ? 'device' : 'devices'} signed in` : 'No devices signed in yet'}</span><button className="secondary small" onClick={() => run(newPhonePin)}>New PIN</button></div>
      <p className="phone-note">A new PIN signs every phone out. The phone stays signed in for 30 days. Editing works best on a big screen; on a phone, review, play back and check exports.</p>
    </>}
    {problem && <p className="phone-warning" role="alert">{problem}</p>}
  </div>;
}
