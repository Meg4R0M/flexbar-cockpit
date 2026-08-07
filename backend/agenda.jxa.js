// Next calendar event via EventKit, run through osascript (Apple-notarised, so it
// can obtain Calendar access where an ad-hoc-signed binary cannot). Prints one JSON
// line. Access request is async, so we spin the run loop until it resolves.
//   { ok, title, start:"yyyy-MM-dd HH:mm", allDay, calendar } | { none } | { noaccess, status }
ObjC.import('EventKit')
ObjC.import('Foundation')

function run () {
  const store = $.EKEventStore.alloc.init
  let done = false
  let granted = false
  const cb = function (g) { granted = g ? true : false; done = true }
  try { store.requestFullAccessToEventsCompletion(cb) } // macOS 14+
  catch (e) { try { store.requestAccessToEntityTypeCompletion(0, cb) } catch (e2) { return JSON.stringify({ error: 'req' }) } }

  const start = Date.now()
  while (!done && (Date.now() - start) < 20000) {
    $.NSRunLoop.currentRunLoop.runModeBeforeDate($.NSDefaultRunLoopMode, $.NSDate.dateWithTimeIntervalSinceNow(0.05))
  }
  if (!granted) return JSON.stringify({ noaccess: true, status: $.EKEventStore.authorizationStatusForEntityType(0) })

  const now = $.NSDate.date
  const end = $.NSCalendar.currentCalendar.dateByAddingUnitValueToDateOptions(16 /* day */, 30, now, 0)
  const pred = store.predicateForEventsWithStartDateEndDateCalendars(now, end, store.calendarsForEntityType(0))
  const arr = store.eventsMatchingPredicate(pred)
  if (!arr || arr.count === 0) return JSON.stringify({ none: true })

  const sd = $.NSSortDescriptor.sortDescriptorWithKeyAscending('startDate', true)
  const e = arr.sortedArrayUsingDescriptors($([sd])).objectAtIndex(0)
  const fmt = $.NSDateFormatter.alloc.init
  fmt.dateFormat = 'yyyy-MM-dd HH:mm'
  return JSON.stringify({
    ok: true,
    title: ObjC.unwrap(e.title),
    start: ObjC.unwrap(fmt.stringFromDate(e.startDate)),
    allDay: e.allDay ? true : false,
    calendar: ObjC.unwrap(e.calendar.title)
  })
}
