/*
Heading and distance to waypoint:
$IIRMB,A,x.x,a,,,IIII.II,a,yyyyy.yy,a,x.x,x.x,x.x,A,a*hh
 I I I I I I I I I_Speed to WP in knots
 I I I I I I I I_True heading to destination in degrees
 I I I I I I I_Distance to destination in miles
 I I I I I_ ___ I_Longitude of the WP to destination, E/W
 I I I__ I_Latidude of the WP to destination, N/S
 I I_Direction of cross-track error, L/R
 I_Distance of cross-track error in miles
*/
// to verify
/*
 * RMB - Recommended Minimum Navigation Information
 * Generates $--RMB with cross-track error, origin/destination, range, bearing and ETA.
 *
 * Enhancements in this PR:
 * - Normalizes units (meters -> nautical miles).
 * - Uses active waypoint position from navigation.courseGreatCircle.nextPoint.position
 *   so waypoints set via NMEA2000/Signal K can be forwarded.
 * - Configurable talker (GP/II) via NMEA_TALKER.
 * - Adds detailed debug logging.
 */

const {
  toSentence,
  talker,
  radToDeg360,
  toNmeaDegreesLatitude,
  toNmeaDegreesLongitude
} = require('../nmea')

module.exports = function rmb (app, plugin, input) {
  try {
    const t = talker()

    // Cross Track Error (meters). Positive means steer right of track.
    const xte = plugin.getProp(input, 'navigation.courseGreatCircle.crossTrackError.value')

    // Origin waypoint ID (optional in Signal K)
    const originId = plugin.getProp(input, 'navigation.courseGreatCircle.origin.name') ||
                     plugin.getProp(input, 'navigation.courseGreatCircle.origin.identifier') || ''

    // Destination / next point info
    const destId = plugin.getProp(input, 'navigation.courseGreatCircle.nextPoint.name') ||
                   plugin.getProp(input, 'navigation.courseGreatCircle.nextPoint.identifier') ||
                   'WAYPOINT'

    const destPos = plugin.getProp(input, 'navigation.courseGreatCircle.nextPoint.position.value')
    const rangeNm = plugin.getProp(input, 'navigation.courseGreatCircle.nextPoint.distance.value') // meters
    const brgTrue = plugin.getProp(input, 'navigation.courseGreatCircle.nextPoint.bearingTrue.value')

    if (xte == null || !destPos || brgTrue == null) {
      plugin.debug('[RMB] Missing fields: need xte, nextPoint.position and nextPoint.bearingTrue')
      return null
    }

    const xteNm = Math.abs(xte) / 1852
    const lOrR = xte >= 0 ? 'R' : 'L'

    const destLatStr = toNmeaDegreesLatitude(destPos.latitude)
    const destLonStr = toNmeaDegreesLongitude(destPos.longitude)

    // Convert meters to NM if provided, else leave empty per sentence spec
    const rangeNmVal = (typeof rangeNm === 'number') ? (rangeNm / 1852) : ''
    const brgTrueDeg = radToDeg360(brgTrue)

    // Velocity towards destination in knots if available
    const vmg = plugin.getProp(input, 'navigation.courseGreatCircle.vmgTowardsDestination.value') // m/s
    const arrivalTime = plugin.getProp(input, 'navigation.courseGreatCircle.estimatedTimeOfArrival.value') // ISO timestamp

    // RMB does not have a native time field, but includes 'arrival status' and 'time to go' in some vendor variants.
    // We'll keep standard RMB fields and leave vendor specifics blank.
    const arrivalStatus = 'A' // 'A' = data valid

    const sentenceParts = [
      `${t}RMB`,
      'A',                          // Status: Active/Valid
      xteNm.toFixed(3),             // Cross track error magnitude (NM)
      lOrR,                         // Direction to steer (L/R)
      originId,                     // Origin waypoint ID
      destId,                       // Destination waypoint ID
      destLatStr.split(',')[0],     // Dest latitude ddmm.mmmm
      destLatStr.split(',')[1],     // N/S
      destLonStr.split(',')[0],     // Dest longitude dddmm.mmmm
      destLonStr.split(',')[1],     // E/W
      rangeNmVal === '' ? '' : Number(rangeNmVal).toFixed(2), // Range to dest (NM)
      brgTrueDeg.toFixed(1),        // Bearing to dest (True, degrees)
      vmg != null ? (vmg * 1.94384).toFixed(2) : '', // Velocity towards dest (kn), if available
      arrivalStatus                 // Arrival circle entered (A/V) - use 'A' when valid
    ]

    const sentence = toSentence(sentenceParts)
    return [sentence]
  } catch (e) {
    plugin.debug('[RMB] Error building sentence:', e.message)
    return null
  }
}
