import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from './lib/supabase'
import './App.css'

type Resource = {
  id: string
  name: string
  description: string
  icon: string
  capacity: number
}

type SchoolSession = {
  id: string
  number: number
  label: string
}

type Availability = {
  booking_date: string
  session_id: string
  available_quantity: number
}

type SavedReservation = {
  groupId: string
  token: string
  resourceName: string
  sessionLabel: string
  dates: string[]
  quantity: number
}

const savedReservationsKey = 'reserves-bonavista-reservations'

const resourcePresentation: Record<string, { icon: string; description: string }> = {
  'Aula STEM': { icon: '✳', description: 'Reserva d’aula' },
  "Aula d'ordinadors": { icon: '▣', description: 'Reserva d’aula' },
  Biblioteca: { icon: '▤', description: 'Reserva d’espai' },
  'Reserva de portàtils': { icon: '▱', description: '20 unitats al centre' },
}

function formatDate(value: string) {
  if (!value) return 'Tria un dia'
  return new Intl.DateTimeFormat('ca-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(`${value}T12:00:00`))
}

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat('ca-ES', {
    day: 'numeric',
    month: 'short',
  }).format(new Date(`${value}T12:00:00`))
}

function dateToInputValue(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function makeBookingDates(start: string, end: string, repeatWeekly: boolean) {
  if (!start) return []
  if (repeatWeekly && !end) return []

  const lastDate = repeatWeekly ? end : start
  if (lastDate < start) return []

  const dates: string[] = []
  const current = new Date(`${start}T12:00:00`)
  const last = new Date(`${lastDate}T12:00:00`)
  while (current <= last && dates.length <= 60) {
    dates.push(dateToInputValue(current))
    current.setDate(current.getDate() + (repeatWeekly ? 7 : 1))
  }
  return dates
}

function readSavedReservations(): SavedReservation[] {
  try {
    const value = localStorage.getItem(savedReservationsKey)
    const parsed: unknown = value ? JSON.parse(value) : []
    return Array.isArray(parsed) ? parsed as SavedReservation[] : []
  } catch {
    return []
  }
}

function App() {
  const [resources, setResources] = useState<Resource[]>([])
  const [sessions, setSessions] = useState<SchoolSession[]>([])
  const [selectedResourceId, setSelectedResourceId] = useState('')
  const [bookingDate, setBookingDate] = useState('')
  const [repeatUntil, setRepeatUntil] = useState('')
  const [selectedSessionId, setSelectedSessionId] = useState('')
  const [teacher, setTeacher] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [repeatWeekly, setRepeatWeekly] = useState(false)
  const [availability, setAvailability] = useState<Availability[]>([])
  const [availabilityRevision, setAvailabilityRevision] = useState(0)
  const [savedReservations, setSavedReservations] = useState<SavedReservation[]>(readSavedReservations)
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingAvailability, setIsLoadingAvailability] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [message, setMessage] = useState('')

  const resource = resources.find((item) => item.id === selectedResourceId)
  const selectedSession = sessions.find((item) => item.id === selectedSessionId)
  const bookingDates = useMemo(
    () => makeBookingDates(bookingDate, repeatUntil, repeatWeekly),
    [bookingDate, repeatUntil, repeatWeekly],
  )
  const availabilityDates = useMemo(
    () => repeatWeekly && !repeatUntil && bookingDate ? [bookingDate] : bookingDates,
    [bookingDate, bookingDates, repeatUntil, repeatWeekly],
  )

  useEffect(() => {
    if (!supabase) {
      setLoadError('La connexió amb la base de dades encara no està configurada.')
      setIsLoading(false)
      return
    }

    let isCurrent = true

    async function loadSchoolData() {
      const [categoriesResult, resourcesResult, sessionsResult] = await Promise.all([
        supabase!.from('resource_categories').select('id,name,sort_order').eq('is_active', true).order('sort_order'),
        supabase!.from('resources').select('id,name,capacity,category_id').eq('is_active', true).order('name'),
        supabase!.from('school_sessions').select('id,session_number,label').eq('is_active', true).order('session_number'),
      ])

      if (!isCurrent) return
      if (categoriesResult.error || resourcesResult.error || sessionsResult.error) {
        setLoadError('No s’han pogut carregar els recursos. La configuració d’accés encara està en preparació.')
        setIsLoading(false)
        return
      }

      const categories = categoriesResult.data ?? []
      const categoryNames = new Map(categories.map((item) => [item.id, item.name]))
      const categoryOrder = new Map(categories.map((item) => [item.id, item.sort_order]))
      const orderedResourceRows = [...(resourcesResult.data ?? [])].sort((left, right) =>
        (categoryOrder.get(left.category_id) ?? 0) - (categoryOrder.get(right.category_id) ?? 0)
        || left.name.localeCompare(right.name),
      )
      const loadedResources = orderedResourceRows.map((item) => {
        const name = categoryNames.get(item.category_id) ?? item.name
        const presentation = resourcePresentation[name] ?? { icon: '◇', description: 'Recurs del centre' }
        return {
          id: item.id,
          name,
          description: item.capacity > 1 ? `${item.capacity} unitats al centre` : presentation.description,
          icon: presentation.icon,
          capacity: item.capacity,
        }
      })

      setResources(loadedResources)
      setSessions((sessionsResult.data ?? []).map((item) => ({
        id: item.id,
        number: item.session_number,
        label: item.label,
      })))
      setIsLoading(false)
    }

    void loadSchoolData()
    return () => {
      isCurrent = false
    }
  }, [])

  useEffect(() => {
    if (!supabase || !resource || availabilityDates.length === 0) {
      setAvailability([])
      return
    }

    let isCurrent = true
    setAvailability([])
    setIsLoadingAvailability(true)

    async function loadAvailability() {
      const { data, error } = await supabase!.rpc('get_reservation_availability', {
        p_resource_id: resource!.id,
        p_booking_dates: availabilityDates,
      })

      if (!isCurrent) return
      if (error) {
        setAvailability([])
      } else {
        setAvailability((data ?? []) as Availability[])
      }
      setIsLoadingAvailability(false)
    }

    void loadAvailability()
    return () => {
      isCurrent = false
    }
  }, [availabilityDates, availabilityRevision, resource])

  function availableForSession(sessionId: string) {
    if (availabilityDates.length === 0) return null
    const records = availability.filter((item) => item.session_id === sessionId)
    if (records.length !== availabilityDates.length) return null
    return Math.min(...records.map((item) => item.available_quantity))
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage('')

    if (!supabase || !resource || !selectedSession) {
      setMessage('Tria un recurs, un dia i una sessió abans de continuar.')
      return
    }
    if (repeatWeekly && !repeatUntil) {
      setMessage('Indica fins a quin dia vols repetir la reserva.')
      return
    }
    if (bookingDates.length === 0 || bookingDates.length > 60) {
      setMessage('El període ha de contindre entre 1 i 60 dates.')
      return
    }
    if (!teacher.trim()) {
      setMessage('Escriu el nom del docent que fa la reserva.')
      return
    }

    const minAvailable = availableForSession(selectedSession.id)
    if (minAvailable !== null && quantity > minAvailable) {
      setMessage(`En alguna de les dates només queden ${minAvailable} unitats disponibles.`)
      return
    }

    setIsSubmitting(true)
    const { data, error } = await supabase.rpc('create_reservation_group', {
      p_teacher_name: teacher.trim(),
      p_resource_id: resource.id,
      p_session_id: selectedSession.id,
      p_booking_dates: bookingDates,
      p_quantity: quantity,
    })
    setIsSubmitting(false)

    if (error) {
      setMessage(error.message.includes('remaining availability')
        ? 'Ja no hi ha prou unitats lliures en una de les dates triades. Revisa la disponibilitat.'
        : 'No s’ha pogut crear la reserva. Torna-ho a provar d’ací a un moment.')
      return
    }

    const created = Array.isArray(data) ? data[0] : data
    if (!created?.group_id || !created?.cancellation_token) {
      setMessage('La reserva no s’ha pogut confirmar. Torna-ho a provar.')
      return
    }

    const newReservation: SavedReservation = {
      groupId: created.group_id,
      token: created.cancellation_token,
      resourceName: resource.name,
      sessionLabel: selectedSession.label,
      dates: bookingDates,
      quantity,
    }
    const nextReservations = [newReservation, ...savedReservations]
    setSavedReservations(nextReservations)
    let storedForCancellation = false
    try {
      localStorage.setItem(savedReservationsKey, JSON.stringify(nextReservations))
      storedForCancellation = true
    } catch {
      // The confirmation remains visible even if local browser storage is unavailable.
    }

    setMessage(storedForCancellation
      ? 'Reserva confirmada. La podràs consultar o cancel·lar des d’aquest navegador.'
      : 'Reserva confirmada. No s’ha pogut guardar en aquest navegador per a consultar-la o cancel·lar-la després.')
    setAvailability([])
    setAvailabilityRevision((revision) => revision + 1)
  }

  async function cancelReservation(reservation: SavedReservation) {
    if (!supabase) return
    const { data, error } = await supabase.rpc('cancel_reservation_group', {
      p_group_id: reservation.groupId,
      p_cancellation_token: reservation.token,
    })

    if (error || data !== true) {
      setMessage('No s’ha pogut cancel·lar la reserva. Torna-ho a provar.')
      return
    }

    const remaining = savedReservations.filter((item) => item.groupId !== reservation.groupId)
    setSavedReservations(remaining)
    try {
      localStorage.setItem(savedReservationsKey, JSON.stringify(remaining))
    } catch {
      // The current screen remains updated even if browser storage is unavailable.
    }
    setMessage('La reserva s’ha cancel·lat.')
    setAvailability([])
    setAvailabilityRevision((revision) => revision + 1)
  }

  const maxQuantity = resource
    ? Math.max(1, Math.min(resource.capacity, availableForSession(selectedSessionId) ?? resource.capacity))
    : 1

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#inici" aria-label="Reserves CEIP Bonavista, inici">
          <span className="brand-symbol" aria-hidden="true">b</span>
          <span className="brand-copy">
            <strong>RESERVES</strong>
            <span>CEIP BONAVISTA</span>
          </span>
        </a>
        <div className="topbar-right">
          <span className="preview-pill"><span /> Sense iniciar sessió</span>
          <button className="help-button" type="button" aria-label="Ajuda">?</button>
        </div>
      </header>

      <main id="inici" className="main-layout">
        <section className="intro-block">
          <div className="intro-copy">
            <p className="overline">ORGANITZACIÓ DEL CENTRE</p>
            <h1>Reserva el que<br className="desktop-break" /> necessites.</h1>
            <p className="lead">Tria un recurs, indica quan el necessites i envia la reserva en un moment.</p>
          </div>
          <div className="intro-art" aria-hidden="true">
            <span className="art-sun" />
            <span className="art-book book-one" />
            <span className="art-book book-two" />
            <span className="art-plant">✳</span>
            <span className="art-caption">Fem fàcil<br />compartir recursos</span>
          </div>
        </section>

        {(isLoading || loadError) && (
          <div className="preview-notice" role={loadError ? 'alert' : 'status'}>
            <span className="notice-icon" aria-hidden="true">i</span>
            <span>{loadError || 'Carregant els recursos del centre…'}</span>
          </div>
        )}

        <div className="content-grid">
          <form className="booking-card" onSubmit={handleSubmit}>
            <div className="card-heading">
              <div>
                <span className="step-label">PAS 1 <span>·</span> RECURS</span>
                <h2>Què vols reservar?</h2>
              </div>
              <span className="heading-icon" aria-hidden="true">✳</span>
            </div>

            <div className="resource-grid" role="radiogroup" aria-label="Tria un recurs">
              {resources.map((item) => (
                <button
                  className={`resource-option${selectedResourceId === item.id ? ' selected' : ''}`}
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={selectedResourceId === item.id}
                  onClick={() => {
                    setSelectedResourceId(item.id)
                    setQuantity(1)
                    setMessage('')
                  }}
                >
                  <span className="resource-icon" aria-hidden="true">{item.icon}</span>
                  <span className="resource-text">
                    <strong>{item.name}</strong>
                    <small>{item.description}</small>
                  </span>
                  <span className="radio-dot" aria-hidden="true" />
                </button>
              ))}
              {!isLoading && !loadError && resources.length === 0 && (
                <p className="empty-state">Encara no hi ha recursos actius.</p>
              )}
            </div>

            <div className="form-divider" />

            <div className="card-heading compact-heading">
              <div>
                <span className="step-label">PAS 2 <span>·</span> DATA I SESSIÓ</span>
                <h2>Quan el necessites?</h2>
              </div>
              <span className="heading-icon calendar-icon" aria-hidden="true">▦</span>
            </div>

            <label className="field-label" htmlFor="booking-date">Dia de la reserva</label>
            <div className="date-field">
              <span aria-hidden="true">▦</span>
              <input
                id="booking-date"
                type="date"
                min={dateToInputValue(new Date())}
                value={bookingDate}
                onChange={(event) => {
                  setBookingDate(event.target.value)
                  setSelectedSessionId('')
                  setMessage('')
                }}
                required
              />
            </div>

            {repeatWeekly && (
              <label className="repeat-end-field" htmlFor="repeat-until">
                <span className="field-label">Repetir fins al dia</span>
                <input
                  id="repeat-until"
                  className="text-input"
                  type="date"
                  min={bookingDate || dateToInputValue(new Date())}
                  value={repeatUntil}
                  onChange={(event) => {
                    setRepeatUntil(event.target.value)
                    setSelectedSessionId('')
                    setMessage('')
                  }}
                  required
                />
              </label>
            )}

            <div className="session-label-row">
              <span className="field-label">Sessió</span>
              <span className="field-hint">Tria una de les sis sessions</span>
            </div>
            <div className="session-grid" role="group" aria-label="Tria una sessió">
              {sessions.map((item) => {
                const available = availableForSession(item.id)
                const unavailable = available !== null && available < 1
                return (
                  <button
                    className={`session-option${selectedSessionId === item.id ? ' selected' : ''}`}
                    key={item.id}
                    type="button"
                    aria-label={`${item.label} sessió${available === null ? '' : `, ${available} unitats disponibles`}`}
                    aria-pressed={selectedSessionId === item.id}
                    disabled={unavailable}
                    onClick={() => {
                      setSelectedSessionId(item.id)
                      setMessage('')
                    }}
                  >
                    <span>{item.label}</span>
                    {isLoadingAvailability && <small>…</small>}
                    {!isLoadingAvailability && available !== null && (
                      <small>{available > 0 ? `${available} lliures` : 'Ocupada'}</small>
                    )}
                  </button>
                )
              })}
            </div>

            <button
              className={`repeat-toggle${repeatWeekly ? ' active' : ''}`}
              type="button"
              aria-pressed={repeatWeekly}
              onClick={() => {
                setRepeatWeekly((value) => !value)
                setRepeatUntil('')
                setSelectedSessionId('')
                setMessage('')
              }}
            >
              <span className="toggle-track"><span /></span>
              <span><strong>Repetir cada setmana</strong><small>Reserva per blocs de dates</small></span>
            </button>
            {repeatWeekly && bookingDates.length > 0 && (
              <p className="block-count">Es crearan {bookingDates.length} reserves setmanals, sempre que hi haja disponibilitat.</p>
            )}

            <div className="form-divider" />

            <div className="card-heading compact-heading">
              <div>
                <span className="step-label">PAS 3 <span>·</span> DADES</span>
                <h2>Qui fa la reserva?</h2>
              </div>
              <span className="heading-icon person-icon" aria-hidden="true">◎</span>
            </div>

            <div className="fields-row">
              <label className="field-group" htmlFor="teacher-name">
                <span className="field-label">Nom del docent</span>
                <input
                  id="teacher-name"
                  className="text-input"
                  type="text"
                  value={teacher}
                  onChange={(event) => setTeacher(event.target.value)}
                  placeholder="Escriu el teu nom"
                  autoComplete="name"
                  maxLength={120}
                  required
                />
              </label>
              {resource && resource.capacity > 1 && (
                <label className="field-group quantity-group" htmlFor="quantity">
                  <span className="field-label">Quantitat (màxim {maxQuantity})</span>
                  <input
                    id="quantity"
                    className="text-input"
                    type="number"
                    min="1"
                    max={maxQuantity}
                    value={quantity}
                    onChange={(event) => setQuantity(Number(event.target.value))}
                    required
                  />
                </label>
              )}
            </div>

            <button className="submit-button" type="submit" disabled={isLoading || isSubmitting || !resource || !selectedSession}>
              {isSubmitting ? 'Enviant…' : 'Confirmar reserva'} <span aria-hidden="true">↗</span>
            </button>
            {message && <p className="form-message" role="status">{message}</p>}
            <p className="form-footnote">Accés directe des de l’enllaç o el QR, sense iniciar sessió.</p>
          </form>

          <aside className="summary-column" aria-label="Resum de la reserva">
            <div className="summary-card">
              <div className="summary-topline">
                <span>EL TEU RESUM</span>
                <span className="summary-spark" aria-hidden="true">✳</span>
              </div>
              <p className="summary-date">{formatDate(bookingDate)}</p>
              <div className="summary-resource">
                <span className="summary-resource-icon" aria-hidden="true">{resource?.icon ?? '◇'}</span>
                <div><small>RECURS</small><strong>{resource?.name ?? 'Tria un recurs'}</strong></div>
              </div>
              <div className="summary-detail">
                <span>Sessió</span><strong>{selectedSession ? `${selectedSession.label} sessió` : 'Pendent de triar'}</strong>
              </div>
              {resource && resource.capacity > 1 && <div className="summary-detail"><span>Unitats</span><strong>{quantity} de {resource.capacity}</strong></div>}
              {repeatWeekly && <div className="repeat-note">Reserva setmanal · {bookingDates.length || 'tria el període'} dates</div>}
              <div className="summary-bottom">
                <span className="summary-check" aria-hidden="true">✓</span>
                <span>Compartir recursos<br />ajuda a tot el centre.</span>
              </div>
            </div>

            <div className="support-card">
              <span className="support-icon" aria-hidden="true">✳</span>
              <div><strong>Necessites ajuda?</strong><p>Consulta amb l’equip de coordinació del centre.</p></div>
              <span className="support-arrow" aria-hidden="true">↗</span>
            </div>

            <div className="my-reservations-card">
              <div className="my-reservations-heading">
                <div><span className="step-label">EN AQUEST NAVEGADOR</span><h2>Les meues reserves</h2></div>
                <span className="reservation-count">{savedReservations.length}</span>
              </div>
              {savedReservations.length === 0 ? (
                <p className="empty-reservations">Ací apareixeran les reserves fetes des d’aquest navegador.</p>
              ) : (
                <ul className="reservation-list">
                  {savedReservations.map((item) => (
                    <li className="reservation-item" key={item.groupId}>
                      <div className="reservation-item-top">
                        <strong>{item.resourceName}</strong>
                        <button type="button" onClick={() => void cancelReservation(item)}>Cancel·lar</button>
                      </div>
                      <span>{item.sessionLabel} sessió · {item.quantity} unitats</span>
                      <small>{item.dates.map(formatShortDate).join(', ')}</small>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>
        </div>
      </main>

      <footer className="footer">
        <span>CEIP BONAVISTA</span>
        <span>Una eina per a compartir millor</span>
      </footer>
    </div>
  )
}

export default App
