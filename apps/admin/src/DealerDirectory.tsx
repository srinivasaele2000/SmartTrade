import {useEffect, useRef, useState, type FormEvent} from 'react';
import {businessTypes, SUB_BUSINESS_TAXONOMY, type BusinessType} from './BusinessType';
import {istDateTime} from './india';
import {requestApi} from './api';
import {useAdminPage} from './useAdminPage';

type Address = {line: string; pincode: string; area: string; district: string; state: string};
type Dealer = {id: number; firm_name: string; owner_name: string; gstin: string; business_type: BusinessType;
  sub_category: string; email: string; mobile_number: string; trade_license: string; registration_number: string;
  address: Address; verification_status: string; worker_contacts_count: number; contacts_submitted_at: string | null};
type Contact = {id: number; name: string; mobile_number: string; trade: string; area: string;
  consent_obtained: boolean; submitted_at: string};
type DealerDetail = Dealer & {worker_contacts: Contact[] | null};
const path = '/admin/dealers/';

function mobileLabel(mobile: string) {
  return mobile.replace(/^\+91(\d{5})(\d{5})$/, '+91 $1 $2');
}

function subBusiness(dealer: Dealer) {
  return SUB_BUSINESS_TAXONOMY[dealer.business_type]?.find(option => option.key === dealer.sub_category)?.label
    || dealer.sub_category || 'Not provided';
}

function addressLabel(address: Address) {
  return [address.line, address.area, address.district, address.state, address.pincode].filter(Boolean).join(', ');
}

function statusLabel(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
}

function DealerInspector({dealer, baseUrl, token, close}: {dealer: Dealer; baseUrl: string; token: string; close: () => void}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, setState] = useState<{detail?: DealerDetail; error?: string}>({});
  const [revision, retry] = useState(0);
  useEffect(() => {dialog.current?.showModal();}, []);
  useEffect(() => {
    const abort = new AbortController();
    setState({});
    void requestApi<DealerDetail>(baseUrl, path + dealer.id + '/', token, {signal: abort.signal})
      .then(detail => {if (!abort.signal.aborted) setState({detail});})
      .catch(error => {if (!abort.signal.aborted) setState({error: error.message});});
    return () => abort.abort();
  }, [baseUrl, dealer.id, revision, token]);
  const {detail, error} = state;
  const registration = detail ?? dealer;
  const contacts = detail?.worker_contacts;

  return <dialog ref={dialog} onClose={close} className="contacts-dialog dealer-inspector" aria-labelledby="directory-contacts-title">
    <h3 id="directory-contacts-title">{registration.firm_name || 'Unnamed dealer'}</h3>
    <section className="detail-card" aria-label="Business registration">
      <h4>Business registration</h4>
      <dl>{[
        ['Owner / contact', registration.owner_name], ['Mobile', mobileLabel(registration.mobile_number)],
        ['Email', registration.email], ['GSTIN', registration.gstin], ['Trade license', registration.trade_license],
        ['Registration reference', registration.registration_number], ['Business type', businessTypes[registration.business_type]],
        ['Sub-Business', subBusiness(registration)], ['Registered address', addressLabel(registration.address)],
        ['Verification', statusLabel(registration.verification_status)],
        ['Worker submission', registration.contacts_submitted_at ? istDateTime(registration.contacts_submitted_at) : 'Batch not submitted'],
      ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || 'Not provided'}</dd></div>)}</dl>
    </section>
    <h4>Trade Worker Network</h4>
    {error ? <><p role="alert">{error}</p><button onClick={() => retry(value => value + 1)}>Retry</button></>
      : !detail ? <p role="status">Loading dealer details…</p>
      : contacts === null ? <p>Your staff role cannot view private worker contact details.</p>
      : !contacts?.length ? <p>No worker contacts on record.</p>
      : <div className="onboarding-table"><table>
        <caption>{detail.worker_contacts_count} worker contacts</caption>
        <thead><tr>{['#', 'Worker name', 'Mobile number', 'Trade / profession', 'Area / locality', 'Consent', 'Consent recorded'].map(value => <th key={value} scope="col">{value}</th>)}</tr></thead>
        <tbody>{contacts.map((item, index) => <tr key={item.id}>
          <td>{index + 1}</td><th scope="row">{item.name}</th><td>{mobileLabel(item.mobile_number)}</td>
          <td>{item.trade}</td><td>{item.area || 'Not provided'}</td>
          <td>{item.consent_obtained ? 'Confirmed' : 'Unconfirmed'}</td>
          <td>{item.submitted_at && <time dateTime={item.submitted_at} title={item.submitted_at + ' (UTC)'}>{istDateTime(item.submitted_at)}</time>}</td>
        </tr>)}</tbody>
      </table></div>}
    <form method="dialog"><button className="button button-quiet">Close dealer details</button></form>
  </dialog>;
}

export default function DealerDirectory({baseUrl, token, permissions}: {baseUrl: string; token: string; permissions: string[]}) {
  const allowed = permissions.includes('REVIEW_BUSINESS');
  const [draftSearch, setDraftSearch] = useState('');
  const [search, setSearch] = useState('');
  const [business, setBusiness] = useState('');
  const filters = new URLSearchParams();
  if (search) filters.set('search', search);
  if (business) filters.set('business_type', business);
  const page = useAdminPage<Dealer>(baseUrl, token, allowed ? path : '', filters.toString());
  const [selected, setSelected] = useState<Dealer | null>(null);

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    page.setNumber(1);
    setSearch(draftSearch.trim());
  }

  if (!allowed) return <p>Your staff role cannot view the dealer directory.</p>;
  return <section className="queue-section" aria-label="Dealer directory">
    <h2>Registered dealers</h2>
    <form className="decision-buttons" onSubmit={submitSearch}>
      <label>Search dealers <input type="search" placeholder="Firm name, mobile or GSTIN" value={draftSearch}
        onChange={event => setDraftSearch(event.target.value)} /></label>
      <button className="button">Search</button>
      <label>Business type <select value={business} onChange={event => {setBusiness(event.target.value); page.setNumber(1);}}>
        <option value="">All business types</option>
        {Object.entries(businessTypes).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></label>
    </form>
    {page.error ? <><p role="alert">{page.error}</p><button onClick={page.reload}>Retry</button></>
      : !page.data ? <p role="status">Loading registered dealers…</p>
      : !page.data.results.length ? <p>{search || business ? 'No dealers match these filters.' : 'No dealers have registered.'}</p>
      : <div className="onboarding-table"><table>
        <caption>Dealer registrations</caption>
        <thead><tr>{['Firm and owner', 'Contact', 'GSTIN and trade license', 'Business type and sub-business', 'Registered address', 'Onboarding and verification', 'Worker contacts'].map(value => <th key={value} scope="col">{value}</th>)}</tr></thead>
        <tbody>{page.data.results.map(dealer => <tr key={dealer.id}>
          <th scope="row"><button onClick={() => setSelected(dealer)}>{dealer.firm_name || 'Unnamed dealer'}</button>
            <div>{dealer.owner_name || 'Owner not provided'}</div></th>
          <td>{mobileLabel(dealer.mobile_number)}<div>{dealer.email || 'Email not provided'}</div></td>
          <td>{dealer.gstin || 'GSTIN not provided'}<div>{dealer.trade_license || 'Trade license not provided'}</div></td>
          <td>{businessTypes[dealer.business_type]}<div>{subBusiness(dealer)}</div></td>
          <td>{addressLabel(dealer.address) || 'Address not provided'}</td>
          <td>{statusLabel(dealer.verification_status)}<div>{dealer.contacts_submitted_at ? 'Worker batch submitted' : 'Worker batch pending'}</div></td>
          <td>{dealer.worker_contacts_count} / 10 on record
            <div><button onClick={() => setSelected(dealer)}>View details</button></div></td>
        </tr>)}</tbody>
      </table></div>}
    {page.data && <nav aria-label="Dealer directory pages">
      <button disabled={!page.data.previous} onClick={() => page.setNumber(page.number - 1)}>Previous</button>
      <button disabled={!page.data.next} onClick={() => page.setNumber(page.number + 1)}>Next</button>
    </nav>}
    {selected && <DealerInspector key={selected.id} dealer={selected} baseUrl={baseUrl} token={token} close={() => setSelected(null)} />}
  </section>;
}
