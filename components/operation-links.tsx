import Link from 'next/link';
import { ArrowUpRight, Calculator, ClipboardList, FileText, FileUp, Truck, Users, Warehouse } from 'lucide-react';
import type { Identity, Row } from '@/lib/domain';
import { orgLink } from './shell';
import styles from './operation-page.module.css';

export function OperationLinks({ identity, site }: { identity: Identity; site?: Row }) {
  const links = [
    { title: 'Clienti', icon: Users, hint: 'Anagrafiche e cantieri per cliente', href: '/clienti' },
    { title: 'Magazzino', icon: Warehouse, hint: 'Articoli e registri di carico e scarico', href: '/gestione/magazzino', kind: 'movement' },
    { title: 'Personale e squadre', icon: Users, hint: 'Dipendenti, operai e squadre', href: '/gestione/personale' },
    { title: 'Fatture', icon: FileText, hint: 'Documenti, importi e scadenze', href: '/gestione/amministrazione', kind: 'invoice' },
    { title: 'Ordini', icon: ClipboardList, hint: 'Ordini e stato delle consegne', href: '/gestione/amministrazione', kind: 'order' },
    { title: 'DDT', icon: Truck, hint: 'Carichi, mittenti e destinatari', href: '/gestione/amministrazione', kind: 'ddt' },
    { title: 'Computi metrici', icon: Calculator, hint: 'Misurazioni, quantità e prezzi', href: '/gestione/computi-metrici' },
    { title: 'Preventivi da PDF', icon: FileUp, hint: 'Applica il tuo listino a un computo', href: '/gestione/preventivi-computo' },
  ];
  return <section className={styles.moduleSection}>
    <h2>{site ? 'Schede del cantiere' : 'Moduli operativi'}</h2>
    <div className={styles.moduleGrid}>{links.filter(item => !site || item.href !== '/clienti').map(({ title, icon: Icon, hint, href, kind }) => {
      const query = new URLSearchParams();
      if (site) query.set('cantiere', site.id);
      if (kind && (kind !== 'movement' || site)) query.set('tipo', kind);
      return <Link key={title} href={orgLink(href + (query.size ? '?' + query : ''), identity)} className={styles.moduleCard}>
        <span className={styles.recordIcon}><Icon size={18}/></span><span><strong>{title}</strong><small>{hint}</small></span>
        <ArrowUpRight className={styles.moduleArrow} size={17}/>
      </Link>;
    })}</div>
  </section>;
}
