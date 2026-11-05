import { useEffect, useMemo, useState, type FormEvent } from 'react'
import './App.css'
import { supabase } from './lib/supabase'

type Resource = {
  id: string
  name: string
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

type PostgrestError = {
  code?: string
  message?: string
  details?: string | null
  hint?: string | null
}

function safePostgrestDiagnostic(error: PostgrestError, teacherName = '') {
  const redact = (value: unknown) => {
    if (typeof value !== 'string') return undefined
    let safe = value
    if (teacherName) safe = safe.split(teacherName).join('[docent ocult]')
    return safe
      .replace(/\bBearer\s+\S+/gi, 'Bearer [ocult]')
      .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[token ocult]')
      .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, '[identificador ocult]')
      .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[token ocult]')
  }
  return {
    code: redact(error.code),
    message: redact(error.message),
    details: redact(error.details),
    hint: redact(error.hint),
  }
}

function logPostgrestError(operation: string, error: PostgrestError, teacherName = '') {
  console.error(`[Supabase] ${operation}`, safePostgrestDiagnostic(error, teacherName))
}

function errorCode(error: PostgrestError | null) {
  return error?.code && /^[A-Z0-9]+$/.test(error.code) ? error.code : ''
}

function formatPostgrestDiagnostic(error: PostgrestError, teacherName = '') {
  const diagnostic = safePostgrestDiagnostic(error, teacherName)
  return [
    diagnostic.code && `Codi ${diagnostic.code}`,
    diagnostic.message && `Missatge: ${diagnostic.message}`,
    diagnostic.details && `Detalls: ${diagnostic.details}`,
    diagnostic.hint && `Ajuda: ${diagnostic.hint}`,
  ].filter(Boolean).join(' · ')
}

type SavedReservation = {
  groupId: string
  resourceName: string
  sessionLabel: string
  dates: string[]
  quantity: number
  teacherName?: string
}

type PublicReservation = {
  groupId: string
  referenceCode: string
  teacherName: string
  resourceName: string
  sessionLabel: string
  sessionNumber: number
  dates: string[]
  quantity: number
}

type AppTab = 'calendar' | 'quick' | 'blocks'
type CalendarScreen = 'calendar' | 'sessions' | 'detail' | 'reservation-detail'

const savedReservationsKey = 'reserves-bonavista-reservations'
const schoolLogo = '/reserves-bonavista/ceip-bonavista-logo.jpg'
const firstSchoolDay = '2026-09-07'
const lastSchoolDay = '2027-06-18'

// Dies no lectius marcats en roig al calendari escolar 2026-27 del centre.
const nonLectiveDates = new Set([
  '2026-09-08', '2026-09-09',
  '2026-10-09', '2026-10-12',
  '2026-12-07', '2026-12-08', '2026-12-23', '2026-12-24', '2026-12-25',
  '2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31',
  '2027-01-01', '2027-01-04', '2027-01-05', '2027-01-06',
  '2027-03-16', '2027-03-17', '2027-03-18', '2027-03-19',
  '2027-03-25', '2027-03-26', '2027-03-29', '2027-03-30', '2027-03-31',
  '2027-04-01', '2027-04-02', '2027-04-05',
])

const schoolDateMarkers: Record<string, string> = {
  '2026-09-07': 'Inici de les classes amb alumnat',
  '2027-06-18': 'Últim dia de classes amb alumnat',
}

function dateToInputValue(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatDate(value: string, withYear = true) {
  if (!value) return 'Tria un dia'
  const date = new Intl.DateTimeFormat('ca-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(withYear ? { year: 'numeric' as const } : {}),
  }).format(new Date(`${value}T12:00:00`))
  return date.charAt(0).toLocaleUpperCase('ca-ES') + date.slice(1)
}

function formatMonth(date: Date) {
  const value = new Intl.DateTimeFormat('ca-ES', { month: 'long', year: 'numeric' }).format(date)
  return value.charAt(0).toLocaleUpperCase('ca-ES') + value.slice(1)
}

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat('ca-ES', { day: 'numeric', month: 'short' })
    .format(new Date(`${value}T12:00:00`))
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

function getCalendarCells(month: Date) {
  const firstDay = new Date(month.getFullYear(), month.getMonth(), 1)
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const mondayOffset = (firstDay.getDay() + 6) % 7
  const cellCount = Math.ceil((mondayOffset + daysInMonth) / 7) * 7

  return Array.from({ length: cellCount }, (_, index) => {
    const day = index - mondayOffset + 1
    if (day < 1 || day > daysInMonth) return null
    const date = new Date(month.getFullYear(), month.getMonth(), day)
    return { day, date: dateToInputValue(date), weekday: date.getDay() }
  })
}

function readSavedReservations(): SavedReservation[] {
  try {
    const value = localStorage.getItem(savedReservationsKey)
    const parsed: unknown = value ? JSON.parse(value) : []
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
      .filter((item) => typeof item.groupId === 'string')
      .map((item) => ({
        groupId: item.groupId as string,
        resourceName: typeof item.resourceName === 'string' ? item.resourceName : '',
        sessionLabel: typeof item.sessionLabel === 'string' ? item.sessionLabel : '',
        dates: Array.isArray(item.dates) ? item.dates.filter((date): date is string => typeof date === 'string') : [],
        quantity: typeof item.quantity === 'number' ? item.quantity : 1,
        teacherName: typeof item.teacherName === 'string' ? item.teacherName : undefined,
      }))
  } catch {
    return []
  }
}

function App() {
  const today = dateToInputValue(new Date())
  const [resources, setResources] = useState<Resource[]>([])
  const [sessions, setSessions] = useState<SchoolSession[]>([])
  const [selectedResourceId, setSelectedResourceId] = useState('')
  const [bookingDate, setBookingDate] = useState(today)
  const [repeatUntil, setRepeatUntil] = useState('')
  const [selectedSessionId, setSelectedSessionId] = useState('')
  const [teacher, setTeacher] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [activeTab, setActiveTab] = useState<AppTab>('calendar')
  const [calendarScreen, setCalendarScreen] = useState<CalendarScreen>('calendar')
  const [visibleMonth, setVisibleMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const [availability, setAvailability] = useState<Availability[]>([])
  const [availabilityRevision, setAvailabilityRevision] = useState(0)
  const [schoolDataRevision, setSchoolDataRevision] = useState(0)
  const [savedReservations, setSavedReservations] = useState<SavedReservation[]>(readSavedReservations)
  const [publicReservations, setPublicReservations] = useState<PublicReservation[]>([])
  const [publicReservationsRevision, setPublicReservationsRevision] = useState(0)
  const [isLoadingReservations, setIsLoadingReservations] = useState(true)
  const [reservationsError, setReservationsError] = useState(false)
  const [openReservationId, setOpenReservationId] = useState('')
  const [reservationReturnScreen, setReservationReturnScreen] = useState<'calendar' | 'sessions'>('calendar')
  const [reservationToCancel, setReservationToCancel] = useState<PublicReservation | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingAvailability, setIsLoadingAvailability] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)
  const [availabilityError, setAvailabilityError] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [message, setMessage] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)

  const resource = resources.find((item) => item.id === selectedResourceId)
  const selectedSession = sessions.find((item) => item.id === selectedSessionId)
  const openReservation = publicReservations.find((item) => item.groupId === openReservationId)
  const localReservation = savedReservations.find((item) => item.groupId === openReservationId)
  const repeatWeekly = activeTab === 'blocks'
  const bookingDates = useMemo(
    () => makeBookingDates(bookingDate, repeatUntil, repeatWeekly),
    [bookingDate, repeatUntil, repeatWeekly],
  )
  const calendarDates = useMemo(() => {
    const daysInMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 0).getDate()
    return Array.from({ length: daysInMonth }, (_, index) =>
      dateToInputValue(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), index + 1)),
    ).filter((date) => date >= today)
  }, [today, visibleMonth])
  const availabilityDates = useMemo(() => {
    if (activeTab === 'blocks') return bookingDates.length ? bookingDates : (bookingDate ? [bookingDate] : [])
    if (activeTab === 'quick') return bookingDate ? [bookingDate] : []
    return calendarDates
  }, [activeTab, bookingDate, bookingDates, calendarDates])
  const calendarCells = useMemo(() => getCalendarCells(visibleMonth), [visibleMonth])

  useEffect(() => {
    if (activeTab === 'calendar' && calendarScreen === 'reservation-detail') {
      document.querySelector('.screen-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [activeTab, calendarScreen, openReservationId])

  useEffect(() => {
    if (!supabase) {
      setLoadError('La connexió amb la base de dades encara no està configurada.')
      setIsLoading(false)
      return
    }

    let isCurrent = true
    async function loadSchoolData() {
      try {
        const [categoriesResult, resourcesResult, sessionsResult] = await Promise.all([
          supabase!.from('resource_categories').select('id,name,sort_order').eq('is_active', true).order('sort_order'),
          supabase!.from('resources').select('id,name,capacity,category_id').eq('is_active', true).order('name'),
          supabase!.from('school_sessions').select('id,session_number,label').eq('is_active', true).order('session_number'),
        ])

        if (!isCurrent) return
        const failures = [categoriesResult.error, resourcesResult.error, sessionsResult.error].filter(Boolean)
        if (failures.length) {
          failures.forEach((error) => logPostgrestError('loadSchoolData', error!))
          const code = errorCode(failures[0])
          setLoadError(`No s’han pogut carregar els recursos. Revisa la connexió i torna-ho a provar.${code ? ` Codi: ${code}.` : ''}`)
          return
        }

        const categories = categoriesResult.data ?? []
        const categoryNames = new Map(categories.map((item) => [item.id, item.name]))
        const categoryOrder = new Map(categories.map((item) => [item.id, item.sort_order]))
        const orderedResourceRows = [...(resourcesResult.data ?? [])].sort((left, right) =>
          (categoryOrder.get(left.category_id) ?? 0) - (categoryOrder.get(right.category_id) ?? 0)
          || left.name.localeCompare(right.name),
        )
        const loadedResources = orderedResourceRows.map((item) => ({
          id: item.id,
          name: categoryNames.get(item.category_id) ?? item.name,
          capacity: item.capacity,
        }))

        setResources(loadedResources)
        setSelectedResourceId((current) => current || loadedResources[0]?.id || '')
        setSessions((sessionsResult.data ?? []).map((item) => ({
          id: item.id,
          number: item.session_number,
          label: item.label,
        })))
        setLoadError('')
      } catch (error) {
        if (!isCurrent) return
        logPostgrestError('loadSchoolData', error as PostgrestError)
        setLoadError('No s’han pogut carregar els recursos per un problema de connexió. Torna-ho a provar.')
      } finally {
        if (isCurrent) setIsLoading(false)
      }
    }

    void loadSchoolData()
    return () => {
      isCurrent = false
    }
  }, [schoolDataRevision])

  useEffect(() => {
    if (!supabase) {
      setIsLoadingReservations(false)
      return
    }

    let isCurrent = true
    async function loadPublicReservations() {
      setIsLoadingReservations(true)
      try {
        const { data, error } = await supabase!.rpc('get_public_active_reservations')
        if (!isCurrent) return
        if (error) {
          logPostgrestError('loadPublicReservations', error)
          setReservationsError(true)
          return
        }

        setPublicReservations(((data ?? []) as Array<{
          group_id: string
          reference_code: string
          teacher_name: string
          resource_name: string
          session_label: string
          session_number: number
          booking_dates: string[]
          quantity: number
        }>).map((item) => ({
          groupId: item.group_id,
          referenceCode: item.reference_code,
          teacherName: item.teacher_name,
          resourceName: item.resource_name,
          sessionLabel: item.session_label,
          sessionNumber: item.session_number,
          dates: item.booking_dates,
          quantity: item.quantity,
        })))
        setReservationsError(false)
      } catch (error) {
        if (!isCurrent) return
        logPostgrestError('loadPublicReservations', error as PostgrestError)
        setReservationsError(true)
      } finally {
        if (isCurrent) setIsLoadingReservations(false)
      }
    }

    void loadPublicReservations()
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void loadPublicReservations()
    }
    window.addEventListener('focus', refreshWhenVisible)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      isCurrent = false
      window.removeEventListener('focus', refreshWhenVisible)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [publicReservationsRevision])

  useEffect(() => {
    if (!supabase || !resource || availabilityDates.length === 0) {
      setAvailability([])
      setIsLoadingAvailability(false)
      return
    }

    let isCurrent = true
    setAvailability([])
    setAvailabilityError(false)
    setIsLoadingAvailability(true)

    async function loadAvailability() {
      try {
        const { data, error } = await supabase!.rpc('get_reservation_availability', {
          p_resource_id: resource!.id,
          p_booking_dates: availabilityDates,
        })

        if (!isCurrent) return
        if (error) logPostgrestError('loadAvailability', error)
        setAvailabilityError(Boolean(error))
        setAvailability(error ? [] : (data ?? []) as Availability[])
      } catch (error) {
        if (!isCurrent) return
        logPostgrestError('loadAvailability', error as PostgrestError)
        setAvailability([])
        setAvailabilityError(true)
      } finally {
        if (isCurrent) setIsLoadingAvailability(false)
      }
    }

    void loadAvailability()
    return () => {
      isCurrent = false
    }
  }, [availabilityDates, availabilityRevision, resource])

  function availableForSession(sessionId: string, dates: string[]) {
    if (dates.length === 0) return null
    const dateSet = new Set(dates)
    const records = availability.filter((item) => item.session_id === sessionId && dateSet.has(item.booking_date))
    if (records.length !== dates.length) return null
    return Math.min(...records.map((item) => item.available_quantity))
  }

  function isNonLectiveDate(date: string) {
    const weekday = new Date(`${date}T12:00:00`).getDay()
    return date < firstSchoolDay || date > lastSchoolDay
      || weekday === 0 || weekday === 6 || nonLectiveDates.has(date)
  }

  function dayStatus(date: string) {
    if (isNonLectiveDate(date)) return 'non-lectiu'
    if (date < today) return 'past'
    if (isLoadingAvailability) return 'loading'
    const statuses = sessions.map((item) => availableForSession(item.id, [date]))
    if (availabilityError || statuses.length === 0 || statuses.some((value) => value === null)) return 'unknown'
    return statuses.some((value) => value !== null && value > 0) ? 'free' : 'reserved'
  }

  function setDate(value: string) {
    setBookingDate(value)
    if (value) {
      const parsed = new Date(`${value}T12:00:00`)
      setVisibleMonth(new Date(parsed.getFullYear(), parsed.getMonth(), 1))
    }
    setSelectedSessionId('')
    setMessage('')
  }

  function openTab(tab: AppTab) {
    setActiveTab(tab)
    setCalendarScreen('calendar')
    setSelectedSessionId('')
    setRepeatUntil('')
    setMessage('')
    setMenuOpen(false)
  }

  function openReservationDetails(reservation: PublicReservation, returnScreen: 'calendar' | 'sessions') {
    setOpenReservationId(reservation.groupId)
    setReservationReturnScreen(returnScreen)
    setActiveTab('calendar')
    setCalendarScreen('reservation-detail')
    setMessage('')
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage('')

    if (!supabase || !resource || !selectedSession) {
      setMessage('Tria un recurs, un dia i una sessió abans de continuar.')
      return
    }
    if (activeTab === 'blocks' && !repeatUntil) {
      setMessage('Indica fins a quin dia vols repetir la reserva.')
      return
    }

    const dates = makeBookingDates(bookingDate, repeatUntil, activeTab === 'blocks')
    if (dates.length === 0 || dates.length > 60) {
      setMessage('El període ha de contindre entre 1 i 60 dates.')
      return
    }
    if (dates.some(isNonLectiveDate)) {
      setMessage('Tria només dies lectius del calendari escolar.')
      return
    }
    if (!teacher.trim()) {
      setMessage('Escriu el nom del docent que fa la reserva.')
      return
    }
    if (isLoadingAvailability) {
      setMessage('Espera un moment mentre comprovem la disponibilitat.')
      return
    }

    const minAvailable = availableForSession(selectedSession.id, dates)
    if (minAvailable !== null && quantity > minAvailable) {
      setMessage(`En alguna de les dates només queden ${minAvailable} unitats disponibles.`)
      return
    }

    setIsSubmitting(true)
    let data: any
    let error: PostgrestError | null = null
    try {
      const result = await supabase.rpc('create_reservation_group', {
        p_teacher_name: teacher.trim(),
        p_resource_id: resource.id,
        p_session_id: selectedSession.id,
        p_booking_dates: dates,
        p_quantity: quantity,
      })
      data = result.data
      error = result.error
    } catch (caught) {
      logPostgrestError('createReservationGroup', caught as PostgrestError, teacher.trim())
      setMessage('No s’ha pogut crear la reserva per un problema de connexió. Torna-ho a provar.')
      return
    } finally {
      setIsSubmitting(false)
    }

    if (error) {
      logPostgrestError('createReservationGroup', error, teacher.trim())
      const code = errorCode(error)
      const diagnostic = formatPostgrestDiagnostic(error, teacher.trim())
      setMessage(error.message?.includes('remaining availability')
        ? `Ja no hi ha prou unitats lliures en una de les dates triades. Revisa la disponibilitat.${diagnostic ? ` ${diagnostic}` : ''}`
        : error.message?.includes('non-lective')
          ? `Hi ha una data no lectiva en la selecció. Revisa el calendari escolar.${diagnostic ? ` ${diagnostic}` : ''}`
          : `No s’ha pogut crear la reserva. Torna-ho a provar d’ací a un moment.${diagnostic ? ` ${diagnostic}` : code ? ` Codi: ${code}.` : ''}`)
      return
    }

    const created = Array.isArray(data) ? data[0] : data
    if (!created?.group_id) {
      setMessage('La reserva no s’ha pogut confirmar. Torna-ho a provar.')
      return
    }

    const nextReservations: SavedReservation[] = [{
      groupId: created.group_id,
      resourceName: resource.name,
      sessionLabel: selectedSession.label,
      dates,
      quantity,
      teacherName: teacher.trim(),
    }, ...savedReservations]
    setSavedReservations(nextReservations)
    try {
      localStorage.setItem(savedReservationsKey, JSON.stringify(nextReservations))
    } catch {
      // La confirmació continua visible encara que el navegador no puga guardar-la.
    }

    setMessage('Reserva confirmada. Ara apareix a les reserves actives del centre, també en altres dispositius.')
    setAvailabilityRevision((revision) => revision + 1)
    setPublicReservationsRevision((revision) => revision + 1)
    setActiveTab('calendar')
    setCalendarScreen('sessions')
  }

  async function cancelReservation(reservation: PublicReservation) {
    if (!supabase) return
    try {
      setIsCancelling(true)
      const { data, error } = await supabase.rpc('cancel_reservation_group_public', {
        p_group_id: reservation.groupId,
      })

      if (error || data !== true) {
        if (error) logPostgrestError('cancelReservationGroupPublic', error)
        setMessage('No s’ha pogut anul·lar la reserva. Pot ser que ja s’haja anul·lat; actualitza la llista i torna-ho a comprovar.')
        setReservationToCancel(null)
        setPublicReservationsRevision((revision) => revision + 1)
        return
      }

      setPublicReservations((current) => current.filter((item) => item.groupId !== reservation.groupId))
      const remaining = savedReservations.filter((item) => item.groupId !== reservation.groupId)
      setSavedReservations(remaining)
      try {
        localStorage.setItem(savedReservationsKey, JSON.stringify(remaining))
      } catch {
        // La pantalla actual es manté actualitzada encara que el navegador no puga guardar-la.
      }
      setMessage('La reserva s’ha anul·lat.')
      setReservationToCancel(null)
      setCalendarScreen(reservationReturnScreen)
      setAvailabilityRevision((revision) => revision + 1)
      setPublicReservationsRevision((revision) => revision + 1)
    } catch (error) {
      logPostgrestError('cancelReservationGroupPublic', error as PostgrestError)
      setMessage('No s’ha pogut anul·lar la reserva per un problema de connexió. Torna-ho a provar.')
      setReservationToCancel(null)
    } finally {
      setIsCancelling(false)
    }
  }

  function modifyReservation(reservation: SavedReservation) {
    const matchedResource = resources.find((item) => item.name === reservation.resourceName)
    const matchedSession = sessions.find((item) => item.label === reservation.sessionLabel)
    const firstDate = reservation.dates[0] ?? today
    if (matchedResource) setSelectedResourceId(matchedResource.id)
    setDate(firstDate)
    setSelectedSessionId(matchedSession?.id ?? '')
    setTeacher(reservation.teacherName ?? '')
    setQuantity(reservation.quantity)
    setActiveTab('quick')
    setCalendarScreen('calendar')
    setMessage('Prepara la nova reserva i crea-la; després podràs anul·lar l’anterior.')
  }

  const requestedDates = activeTab === 'blocks' ? bookingDates : (bookingDate ? [bookingDate] : [])
  const maxQuantity = resource
    ? Math.max(1, Math.min(resource.capacity, availableForSession(selectedSessionId, requestedDates) ?? resource.capacity))
    : 1

  function renderResourceField() {
    return (
      <label className="field-label field-stack resource-choice-field" htmlFor="resource-choice">
        <span>Espai o recurs</span>
        <select
          id="resource-choice"
          className="resource-select"
          value={selectedResourceId}
          onChange={(event) => {
            setSelectedResourceId(event.target.value)
            setQuantity(1)
            setSelectedSessionId('')
            setMessage('')
          }}
          required
        >
          <option value="" disabled>Tria un recurs</option>
          {resources.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
    )
  }

  function renderSessionRows(dates: string[], selectSession: (session: SchoolSession) => void) {
    return (
      <div className="session-list" role="group" aria-label="Sessions del dia" aria-busy={isLoadingAvailability}>
        {sessions.map((item) => {
          const available = availableForSession(item.id, dates)
          const unavailable = available !== null && available < 1
          const matchingReservations = unavailable && resource
            ? publicReservations.filter((reservation) =>
                reservation.resourceName === resource.name
                && reservation.sessionLabel === item.label
                && reservation.dates.some((date) => dates.includes(date)))
            : []
          const reservationToOpen = matchingReservations.length === 1 ? matchingReservations[0] : undefined
          const selected = selectedSessionId === item.id
          const status = isLoadingAvailability ? 'Comprovant…'
            : unavailable ? reservationToOpen ? `Reservada · ${reservationToOpen.teacherName}` : 'Reservada'
              : available === null ? '—'
                : resource && resource.capacity > 1 ? `${available} lliures` : 'Lliure'

          return (
            <button
              className={`session-row${unavailable ? ' reserved' : ' free'}${reservationToOpen ? ' manageable' : ''}${selected ? ' selected' : ''}`}
              key={item.id}
              type="button"
              aria-label={`${item.number}a sessió, ${status}${reservationToOpen ? ', toca per a revisar o anul·lar la reserva' : ''}`}
              disabled={(unavailable && !reservationToOpen) || dates.length === 0}
              onClick={() => reservationToOpen
                ? openReservationDetails(reservationToOpen, 'sessions')
                : selectSession(item)}
            >
              <strong>{item.number}a sessió</strong>
              <span className="session-status">{status}</span>
              <span className="row-chevron" aria-hidden="true">{unavailable && !reservationToOpen ? '' : '›'}</span>
            </button>
          )
        })}
      </div>
    )
  }

  function renderTeacherAndQuantity() {
    return (
      <div className="form-fields">
        <label className="field-label field-stack" htmlFor="teacher-name">
          <span>Nom del docent</span>
          <input
            id="teacher-name"
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
          <label className="field-label field-stack" htmlFor="quantity">
            <span>Quantitat (fins a {maxQuantity})</span>
            <input
              id="quantity"
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
    )
  }

  function renderMessage() {
    return message ? <p className="app-message" role="status">{message}</p> : null
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#inici" aria-label="Reserves CEIP Bonavista, inici" onClick={() => openTab('calendar')}>
          <img className="brand-logo" src={schoolLogo} alt="CEIP Bonavista d’Alaquàs" />
          <span className="brand-school">
            <span>Generalitat Valenciana</span>
            <strong>CEIP BONAVISTA</strong>
          </span>
        </a>
        <div className="topbar-actions">
          <button
            className="menu-button"
            type="button"
            aria-label={menuOpen ? 'Tancar menú' : 'Obrir menú'}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? '×' : '☰'}
          </button>
        </div>
        {menuOpen && (
          <div className="menu-popover">
            <strong>Reserves del centre</strong>
            <button type="button" onClick={() => { openTab('calendar'); setCalendarScreen('calendar') }}>Calendari</button>
            <button type="button" onClick={() => openTab('quick')}>Reserva ràpida</button>
            <button type="button" onClick={() => openTab('blocks')}>Reserva per blocs</button>
                        <a href="#reserves-actives" onClick={() => openTab('calendar')}>Reserves actives</a>
          </div>
        )}
      </header>

      <nav className="mode-tabs" aria-label="Tipus de reserva">
        <button type="button" className={activeTab === 'calendar' ? 'active' : ''} onClick={() => openTab('calendar')}>
          <span aria-hidden="true">▦</span>Calendari
        </button>
        <button type="button" className={activeTab === 'quick' ? 'active' : ''} onClick={() => openTab('quick')}>
          <span aria-hidden="true">▢</span>Reserva ràpida
        </button>
        <button type="button" className={activeTab === 'blocks' ? 'active' : ''} onClick={() => openTab('blocks')}>
          <span aria-hidden="true">▣</span>Per blocs
        </button>
      </nav>

      <main id="inici" className="main-layout">
        {(isLoading || loadError) && (
          <div className={`notice${loadError ? ' error' : ''}`} role={loadError ? 'alert' : 'status'}>
            {loadError || 'Carregant els recursos del centre…'}
            {loadError && <button type="button" className="text-button" onClick={() => { setLoadError(''); setIsLoading(true); setSchoolDataRevision((revision) => revision + 1) }}>Torna-ho a provar</button>}
          </div>
        )}
        {activeTab === 'calendar' && renderMessage()}

        {activeTab === 'calendar' && (
          <section className="screen-card">
            {calendarScreen === 'calendar' && (
              <>
                <div className="screen-heading"><span className="heading-icon">▦</span><div><p>RESERVA PER DATA</p><h1>Calendari</h1></div></div>
                {renderResourceField()}
                <div className="month-controls">
                  <button type="button" aria-label="Mes anterior" onClick={() => setVisibleMonth((month) => new Date(month.getFullYear(), month.getMonth() - 1, 1))}>‹</button>
                  <h2>{formatMonth(visibleMonth)}</h2>
                  <button type="button" aria-label="Mes següent" onClick={() => setVisibleMonth((month) => new Date(month.getFullYear(), month.getMonth() + 1, 1))}>›</button>
                </div>
                <div className="weekday-labels" aria-hidden="true">
                  {['Dl', 'Dt', 'Dc', 'Dj', 'Dv', 'Ds', 'Dg'].map((day) => <span key={day}>{day}</span>)}
                </div>
                <div className="calendar-grid" role="grid" aria-label={formatMonth(visibleMonth)}>
                  {calendarCells.map((cell, index) => {
                    if (!cell) return <span className="calendar-empty" key={`empty-${index}`} />
                    const status = dayStatus(cell.date)
                    const isDisabled = cell.date < today || status === 'non-lectiu'
                    const marker = schoolDateMarkers[cell.date]
                    return (
                      <button
                        className={`calendar-day day-${status}${bookingDate === cell.date ? ' selected' : ''}${marker ? ' day-milestone' : ''}`}
                        key={cell.date}
                        type="button"
                        role="gridcell"
                        title={marker}
                        aria-label={`${formatDate(cell.date)}${marker ? `, ${marker}` : ''}${status === 'non-lectiu' ? ', no lectiu' : status === 'reserved' ? ', sense sessions lliures' : status === 'free' ? ', amb sessions lliures' : ''}`}
                        aria-pressed={bookingDate === cell.date}
                        disabled={isDisabled}
                        onClick={() => {
                          setDate(cell.date)
                          setCalendarScreen('sessions')
                        }}
                      >
                        <span>{cell.day}</span>
                        {status !== 'past' && <i aria-hidden="true" />}
                      </button>
                    )
                  })}
                </div>
                <div className="calendar-legend">
                  <span><i className="legend-free" />Lliure</span>
                  <span><i className="legend-reserved" />Reservada</span>
                  <span><i className="legend-closed" />No lectiu</span>
                </div>
                {availabilityError && <p className="inline-note">No s’ha pogut consultar la disponibilitat ara mateix. <button type="button" className="text-button" onClick={() => setAvailabilityRevision((revision) => revision + 1)}>Torna-ho a provar</button></p>}
                <div id="reserves-actives" className="saved-section">
                  <div className="section-heading">
                    <h2>Reserves actives</h2>
                    <span>{publicReservations.length}</span>
                  </div>
                  <p className="inline-note">Les reserves actives i el nom del docent són visibles per a qualsevol persona amb aquest enllaç. Qualsevol pot demanar-ne l’anul·lació després de revisar les dades.</p>
                  <button
                    className="text-button refresh-reservations"
                    type="button"
                    onClick={() => setPublicReservationsRevision((revision) => revision + 1)}
                    disabled={isLoadingReservations}
                  >
                    {isLoadingReservations ? 'Actualitzant…' : 'Actualitzar reserves'}
                  </button>
                  {reservationsError ? (
                    <p className="inline-note" role="alert">No s’han pogut carregar les reserves. Comprova que la gestió compartida estiga activada a Supabase i torna-ho a provar.</p>
                  ) : isLoadingReservations && publicReservations.length === 0 ? (
                    <p className="empty-note" role="status">Carregant les reserves actives…</p>
                  ) : publicReservations.length === 0 ? (
                    <p className="empty-note">No hi ha reserves actives pròximes.</p>
                  ) : (
                    <div className="saved-list">
                      {publicReservations.map((item) => (
                        <button className="saved-item" type="button" key={item.groupId} onClick={() => openReservationDetails(item, 'calendar')}>
                          <span>
                            <strong>{item.resourceName}</strong>
                            <small>{item.teacherName} · {formatShortDate(item.dates[0])} · {item.sessionNumber}a sessió · {item.quantity} {item.quantity === 1 ? 'unitat' : 'unitats'}</small>
                            <small>Ref. {item.referenceCode}{item.dates.length > 1 ? ` · ${item.dates.length} dates` : ''}</small>
                          </span>
                          <span className="row-chevron" aria-hidden="true">›</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}

            {calendarScreen === 'sessions' && (
              <>
                <button className="back-link" type="button" onClick={() => setCalendarScreen('calendar')}>‹ <span>Tornar al calendari</span></button>
                <div className="screen-heading"><span className="heading-icon">▦</span><div><p>DISPONIBILITAT DEL DIA</p><h1>Sessions del dia</h1></div></div>
                <div className="selected-resource-banner">
                  <span>Espai o material</span>
                  <strong>{resource?.name ?? 'Tria un recurs'}</strong>
                </div>
                <h2 className="selected-date-heading">{formatDate(bookingDate)}</h2>
                {renderSessionRows([bookingDate], (item) => {
                  setSelectedSessionId(item.id)
                  setCalendarScreen('detail')
                })}
                <p className="inline-note">Toca una sessió lliure per a reservar. Per a revisar o anul·lar una reserva, consulta «Reserves actives».</p>
                {availabilityError && <p className="inline-note">No s’ha pogut consultar la disponibilitat ara mateix. <button type="button" className="text-button" onClick={() => setAvailabilityRevision((revision) => revision + 1)}>Torna-ho a provar</button></p>}
              </>
            )}

            {calendarScreen === 'detail' && (
              <>
                <button className="back-link" type="button" onClick={() => setCalendarScreen('sessions')}>‹ <span>Tornar a les sessions</span></button>
                <div className="screen-heading"><span className="heading-icon">▢</span><div><p>DETALL DE LA RESERVA</p><h1>Confirma les dades</h1></div></div>
                <div className="reservation-summary">
                  <div className="reservation-resource-highlight">
                    <span>Espai o material seleccionat</span>
                    <strong>{resource?.name ?? 'Tria un recurs'}</strong>
                  </div>
                  <span>▦ &nbsp;{formatDate(bookingDate)}</span>
                  <span>◷ &nbsp;{selectedSession ? `${selectedSession.number}a sessió` : ''}</span>
                </div>
                <form className="reservation-form" onSubmit={handleSubmit}>
                  {renderTeacherAndQuantity()}
                  {isLoadingAvailability && <p className="inline-note" role="status">Comprovant la disponibilitat; podràs confirmar quan acabe.</p>}
                  {message && <p className="app-message" role="status">{message}</p>}
                  <button className="primary-button" type="submit" disabled={isSubmitting || isLoadingAvailability || !selectedSession}>
                    {isSubmitting ? 'Enviant…' : 'Confirmar reserva'}
                  </button>
                </form>
              </>
            )}

            {calendarScreen === 'reservation-detail' && openReservation && (
              <>
                <button className="back-link" type="button" onClick={() => setCalendarScreen(reservationReturnScreen)}>‹ <span>{reservationReturnScreen === 'sessions' ? 'Tornar a les sessions' : 'Reserves actives'}</span></button>
                <div className="screen-heading"><span className="heading-icon">▢</span><div><p>DETALL DE LA RESERVA</p><h1>Reserva activa</h1></div></div>
                <div className="reservation-summary">
                  <div className="reservation-resource-highlight">
                    <span>Espai o material reservat</span>
                    <strong>{openReservation.resourceName}</strong>
                  </div>
                  <span>♙ &nbsp;Reservada per: {openReservation.teacherName}</span>
                  {openReservation.dates.map((date) => <span key={date}>▦ &nbsp;{formatDate(date)}</span>)}
                  <span>◷ &nbsp;{openReservation.sessionNumber}a sessió</span>
                  <span>Quantitat &nbsp;{openReservation.quantity} {openReservation.quantity === 1 ? 'unitat' : 'unitats'}</span>
                  <span>Referència &nbsp;{openReservation.referenceCode}</span>
                </div>
                <div className="detail-actions">
                  <button className="danger-outline" type="button" onClick={() => setReservationToCancel(openReservation)}>⌫ &nbsp;Anul·lar reserva</button>
                  {localReservation && <button className="secondary-button" type="button" onClick={() => modifyReservation(localReservation)}>✎ &nbsp;Modificar</button>}
                </div>
              </>
            )}

            {calendarScreen === 'reservation-detail' && !openReservation && (
              <>
                <button className="back-link" type="button" onClick={() => setCalendarScreen(reservationReturnScreen)}>‹ <span>{reservationReturnScreen === 'sessions' ? 'Tornar a les sessions' : 'Reserves actives'}</span></button>
                <p className="empty-note" role="status">Aquesta reserva ja no està activa o s’ha anul·lat des d’un altre dispositiu.</p>
                <button className="text-button" type="button" onClick={() => setPublicReservationsRevision((revision) => revision + 1)}>Actualitzar reserves</button>
              </>
            )}
          </section>
        )}

        {(activeTab === 'quick' || activeTab === 'blocks') && (
          <section className="screen-card">
            <div className="screen-heading"><span className="heading-icon">{activeTab === 'quick' ? '▢' : '▣'}</span><div><p>{activeTab === 'quick' ? 'UNA RESERVA' : 'RESERVES RECURRENTS'}</p><h1>{activeTab === 'quick' ? 'Reserva ràpida' : 'Reserva per blocs'}</h1></div></div>
            <form className="reservation-form" onSubmit={handleSubmit}>
              {renderResourceField()}
              <label className="field-label field-stack" htmlFor="booking-date">
                <span>Dia de la reserva</span>
                <input id="booking-date" type="date" min={today} value={bookingDate} onChange={(event) => setDate(event.target.value)} required />
              </label>
              {activeTab === 'blocks' && (
                <label className="field-label field-stack" htmlFor="repeat-until">
                  <span>Repetir cada setmana fins al dia</span>
                  <input
                    id="repeat-until"
                    type="date"
                    min={bookingDate || today}
                    value={repeatUntil}
                    onChange={(event) => { setRepeatUntil(event.target.value); setSelectedSessionId(''); setMessage('') }}
                    required
                  />
                  <small>Es repetiran les mateixes sessions cada setmana, fins a 60 dates.</small>
                </label>
              )}
              <div className="section-heading"><h2>{activeTab === 'blocks' ? 'Sessió per a cada data' : 'Sessions del dia'}</h2></div>
              {activeTab === 'blocks' && bookingDates.length > 0 && <p className="inline-note">Es crearan {bookingDates.length} reserves setmanals, sempre que hi haja disponibilitat.</p>}
              {renderSessionRows(activeTab === 'blocks' ? bookingDates : [bookingDate], (item) => { setSelectedSessionId(item.id); setMessage('') })}
              {isLoadingAvailability && <p className="inline-note" role="status">Comprovant la disponibilitat; podràs confirmar quan acabe.</p>}
              {renderTeacherAndQuantity()}
              {message && <p className="app-message" role="status">{message}</p>}
              <button className="primary-button" type="submit" disabled={isSubmitting || isLoading || isLoadingAvailability || !selectedSession}>
                {isSubmitting ? 'Enviant…' : activeTab === 'blocks' ? 'Confirmar reserves' : 'Reservar'}
              </button>
            </form>
          </section>
        )}

      </main>

      <footer className="footer"><span>CEIP BONAVISTA</span><span>Una eina per a compartir millor</span></footer>

      {reservationToCancel && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setReservationToCancel(null) }}>
          <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="cancel-title">
            <span className="trash-icon" aria-hidden="true">⌫</span>
            <h2 id="cancel-title">Confirma l’anul·lació</h2>
            <div className="cancel-reservation-details">
              <strong>{reservationToCancel.resourceName}</strong>
              <span>Reservada per: {reservationToCancel.teacherName}</span>
              <span>{reservationToCancel.sessionNumber}a sessió · {reservationToCancel.quantity} {reservationToCancel.quantity === 1 ? 'unitat' : 'unitats'}</span>
              <span>Referència {reservationToCancel.referenceCode}</span>
              <ul>
                {reservationToCancel.dates.map((date) => <li key={date}>{formatDate(date)}</li>)}
              </ul>
            </div>
            <p>Si és una reserva per blocs, s’anul·laran totes les dates que apareixen ací.</p>
            <button className="confirm-danger" type="button" disabled={isCancelling} onClick={() => void cancelReservation(reservationToCancel)}>{isCancelling ? 'Anul·lant…' : 'Sí, anul·lar aquestes dates'}</button>
            <button className="secondary-button" type="button" disabled={isCancelling} onClick={() => setReservationToCancel(null)}>No, tornar</button>
          </section>
        </div>
      )}
    </div>
  )
}

export default App
