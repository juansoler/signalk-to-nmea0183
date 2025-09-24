/*
 * APB - Autopilot Sentence "APB"
 * Generates $--APB using current cross-track error, bearings and waypoint information.
 *
 * Enhancements in this PR:
 * - Uses the real waypoint identifier/name instead of a fixed placeholder.
 * - Computes magnetic bearing from navigation.magneticVariation if needed.
 * - Configurable talker ID (GP/II) via NMEA_TALKER env var.
 * - Adds debug logging to help troubleshoot field selection.
 */

const {
  toSentence,
  radToDeg360,
  talker
} = require('../nmea')

module.exports = function apb (app, plugin, input) {
  // input: Signal K "delta" object
  // Returns array with one NMEA sentence string or null if not enough data.

  try {
    const t = talker()

    // Pull required values from Signal K, preferring courseGreatCircle (CGC)
    // as it is consistent with RMB/RTE/WPL route data.
    const xte = plugin.getProp(input, 'navigation.courseGreatCircle.crossTrackError.value') // meters, + right of track
    const brgTrue = plugin.getProp(input, 'navigation.courseGreatCircle.bearingTrackTrue.value') ??
                    plugin.getProp(input, 'navigation.courseRhumbline.bearingTrackTrue.value')

    // Use next point info when available (often set by Course API / active route)
    const nextTrue = plugin.getProp(input, 'navigation.courseGreatCircle.nextPoint.bearingTrue.value') ??
                     plugin.getProp(input, 'navigation.courseRhumbline.nextPoint.bearingTrue.value')

    // Magnetic variation or bearingMagnetic if provided
    const varMag = plugin.getProp(input, 'navigation.magneticVariation.value') // radians (+E)
    const brgMag = plugin.getProp(input, 'navigation.courseGreatCircle.bearingTrackMagnetic.value') ??
                   (brgTrue != null && varMag != null ? (brgTrue + varMag) : null)

    // Waypoint identifier (prefer name/id on nextPoint)
    const wpId = plugin.getProp(input, 'navigation.courseGreatCircle.nextPoint.name') ||
                 plugin.getProp(input, 'navigation.courseGreatCircle.nextPoint.identifier') ||
                 'WAYPOINT'

    if (xte == null || (brgTrue == null && nextTrue == null)) {
      plugin.debug('[APB] Missing fields: xte or bearings not available')
      return null
    }

    // APB fields (NMEA 0183 v2.3):
    // A, A, XTE, L/R, cross track magnitude (NM), units=N, bearing origin to dest (deg True),
    // bearing origin to dest (deg Mag), heading to steer (deg True), heading to steer (deg Mag),
    // dest waypoint ID, mode (A=Autopilot), FAA mode (A=Autonomous)
    const xteNm = Math.abs(xte) / 1852 // meters -> nautical miles
    const lOrR = xte >= 0 ? 'R' : 'L'

    const bearingTrueDeg = radToDeg360(nextTrue != null ? nextTrue : brgTrue)
    const bearingMagDeg = brgMag != null ? radToDeg360(brgMag) : ''

    // Some pilots expect heading-to-steer to match true/mag bearings
    const htsTrueDeg = bearingTrueDeg
    const htsMagDeg = bearingMagDeg

    const sentenceParts = [
      `${t}APB`,
      'A', // Status: Loran-C Blink/SNR warning (A=OK)
      'A', // Status: Loran-C Cycle Lock warning (A=OK)
      xteNm.toFixed(3),
      lOrR,
      'N',
      bearingTrueDeg.toFixed(1),
      'T',
      bearingMagDeg === '' ? '' : bearingMagDeg.toFixed(1),
      'M',
      htsTrueDeg.toFixed(1),
      'T',
      htsMagDeg === '' ? '' : htsMagDeg.toFixed(1),
      'M',
      wpId,
      'A', // mode indicator
      'A'  // FAA mode (A = Autonomous)
    ]

    const sentence = toSentence(sentenceParts)
    return [sentence]
  } catch (e) {
    plugin.debug('[APB] Error building sentence:', e.message)
    return null
  }
}
