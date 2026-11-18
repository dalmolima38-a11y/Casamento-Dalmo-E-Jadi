import React, { useMemo, useState } from 'react';
import { Check, Download, Trash2, X } from 'lucide-react';
import { deleteDoc, doc, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { useWedding } from '../../context/WeddingContext';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { downloadCsv, generateRandomToken } from '../../lib/pix';
import { RsvpRevision, RsvpStatus } from '../../types/wedding';

export const AdminRsvpTab: React.FC = () => {
  const { rsvps, rsvpRevisions, user, demoAdminActive, isAdmin, demoActions } = useWedding();
  const [filter, setFilter] = useState<'all' | RsvpStatus>('all');
  const useDemoStore = demoAdminActive || !isAdmin;

  const filteredRsvps = useMemo(
    () => rsvps.filter((r) => filter === 'all' || r.status === filter),
    [rsvps, filter]
  );

  const pendingRevisions = rsvpRevisions.filter((rev) => rev.reviewStatus === 'pending');

  const logAction = async (action: string, details: string) => {
    if (useDemoStore || !user) return;
    await setDoc(doc(db, 'admin_logs', `log_${generateRandomToken(6)}`), {
      actorUid: user.uid,
      actorEmail: user.email || '',
      action,
      details: details.slice(0, 500),
      createdAt: serverTimestamp(),
    });
  };

  const handleUpdateStatus = async (rsvpId: string, status: RsvpStatus) => {
    if (useDemoStore) {
      demoActions.updateRsvpStatus(rsvpId, status);
      return;
    }
    try {
      await updateDoc(doc(db, 'rsvps', rsvpId), {
        status,
        updatedAt: serverTimestamp(),
      });
      await logAction('Status RSVP atualizado', `${rsvpId} -> ${status}`);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `rsvps/${rsvpId}`);
    }
  };

  const handleDeleteRsvp = async (rsvpId: string) => {
    if (useDemoStore) {
      demoActions.deleteRsvp(rsvpId);
      return;
    }
    try {
      await deleteDoc(doc(db, 'rsvps', rsvpId));
      await logAction('RSVP removido', rsvpId);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `rsvps/${rsvpId}`);
    }
  };

  const handleApplyRevision = async (rev: RsvpRevision, approve: boolean) => {
    if (useDemoStore) {
      demoActions.applyRsvpRevision(rev.id, approve);
      return;
    }
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'rsvp_revisions', rev.id), {
        reviewStatus: approve ? 'applied' : 'rejected',
      });
      if (approve) {
        batch.update(doc(db, 'rsvps', rev.rsvpId), {
          attending: rev.attending,
          attendeesCount: rev.attendeesCount,
          attendeeNames: rev.attendeeNames,
          ...(rev.notes !== undefined ? { notes: rev.notes } : {}),
          status: rev.attending ? 'approved' : 'declined',
          updatedAt: serverTimestamp(),
        });
      }
      await batch.commit();
      await logAction(
        approve ? 'Revisão de RSVP aplicada' : 'Revisão de RSVP recusada',
        rev.rsvpId
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `rsvp_revisions/${rev.id}`);
    }
  };

  const exportRsvpCsv = () => {
    downloadCsv(
      'convidados-rsvp-dalmo-e-jadi.csv',
      ['Responsável', 'Contato', 'Comparecerá', 'Quantidade', 'Participantes', 'Status', 'Observações'],
      filteredRsvps.map((r) => [
        r.responsibleName,
        r.contact,
        r.attending ? 'Sim' : 'Não',
        r.attendeesCount,
        r.attendeeNames.join(' | '),
        r.status,
        r.notes || '',
      ])
    );
  };

  return (
    <div className="space-y-8">
      {pendingRevisions.length > 0 && (
        <section className="rounded-lg border border-terracota/45 bg-creme-claro p-6">
          <h2 className="font-display text-2xl font-semibold text-terracota-escuro">
            Solicitações de Correção Pendentes ({pendingRevisions.length})
          </h2>
          <div className="mt-4 space-y-3">
            {pendingRevisions.map((rev) => (
              <div
                key={rev.id}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-md border border-dourado/35 bg-creme/60 p-4"
              >
                <div className="text-sm">
                  <p className="font-semibold text-marrom">
                    RSVP {rev.rsvpId} · {rev.attending ? `${rev.attendeesCount} pessoa(s)` : 'Não comparecerá'}
                  </p>
                  {rev.attendeeNames.length > 0 && (
                    <p className="text-xs text-marrom-suave">
                      Nomes: {rev.attendeeNames.join(', ')}
                    </p>
                  )}
                  {rev.notes && <p className="text-xs italic text-marrom-suave">{rev.notes}</p>}
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleApplyRevision(rev, true)}
                    className="inline-flex items-center gap-1 rounded-md bg-salvia px-3 py-1.5 text-xs font-semibold text-white"
                  >
                    <Check className="h-3.5 w-3.5" />
                    Aplicar revisão
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApplyRevision(rev, false)}
                    className="inline-flex items-center gap-1 rounded-md border border-dourado/40 px-3 py-1.5 text-xs text-marrom"
                  >
                    <X className="h-3.5 w-3.5" />
                    Rejeitar
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="rounded-lg border border-dourado/35 bg-creme-claro p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap gap-2">
            {(
              [
                ['all', 'Todos'],
                ['pending_review', 'Pendentes'],
                ['approved', 'Confirmados'],
                ['declined', 'Recusados'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                  filter === key
                    ? 'bg-terracota-escuro text-creme-claro'
                    : 'border border-dourado/40 text-marrom hover:bg-pergaminho'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={exportRsvpCsv}
            className="inline-flex items-center gap-2 rounded-md border border-terracota-escuro px-3.5 py-2 text-xs font-semibold text-terracota-escuro uppercase hover:bg-terracota/10"
          >
            <Download className="h-4 w-4" />
            Exportar CSV
          </button>
        </div>

        {filteredRsvps.length === 0 ? (
          <p className="mt-6 text-sm text-marrom-suave">Nenhum registro nesta seleção.</p>
        ) : (
          <div className="mt-5 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-dourado/25 text-xs uppercase text-marrom-suave">
                  <th className="py-2 pr-4">Responsável</th>
                  <th className="py-2 pr-4">Participantes</th>
                  <th className="py-2 pr-4">Qtd.</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 text-right">Revisão</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dourado/15">
                {filteredRsvps.map((r) => (
                  <tr key={r.id}>
                    <td className="py-3 pr-4">
                      <p className="font-medium text-marrom">{r.responsibleName}</p>
                      <p className="text-xs text-marrom-suave">{r.contact}</p>
                      {r.notes && <p className="text-xs italic text-marrom-suave mt-0.5">{r.notes}</p>}
                    </td>
                    <td className="py-3 pr-4 text-xs text-marrom">
                      {r.attending ? r.attendeeNames.join(', ') : 'Informou ausência'}
                    </td>
                    <td className="py-3 pr-4 font-semibold tabular-nums">{r.attendeesCount}</td>
                    <td className="py-3 pr-4 text-xs font-medium">
                      {r.status === 'approved' && <span className="text-salvia">Aprovado</span>}
                      {r.status === 'pending_review' && (
                        <span className="text-terracota-escuro">Em revisão</span>
                      )}
                      {r.status === 'declined' && <span className="text-marrom-suave">Recusado</span>}
                    </td>
                    <td className="py-3 text-right whitespace-nowrap">
                      <div className="inline-flex gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            handleUpdateStatus(r.id, r.attending ? 'approved' : 'declined')
                          }
                          title="Aprovar resposta"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-salvia text-white"
                        >
                          <Check className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleUpdateStatus(r.id, 'declined')}
                          title="Marcar como recusado"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-dourado/40 text-marrom"
                        >
                          <X className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteRsvp(r.id)}
                          title="Excluir registro"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-dourado/40 text-terracota-escuro"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};
