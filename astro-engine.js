/*!
 * LCAstro — self-contained astronomical + astrological calculation engine
 * for the Location Checker widget.
 *
 * Everything here runs client-side, in the browser, with no server or
 * external ephemeris file. It uses standard low-precision formulas that
 * are widely published in astronomical references (Julian Day, GMST,
 * mean obliquity, the ascendant formula, a truncated Sun/Moon series,
 * and the JPL/Standish approximate Keplerian elements for the planets).
 * Accuracy is roughly arc-minutes to about a degree for the outer
 * planets — more than enough for aspect orbs of a few degrees.
 *
 * The location point is computed as RelocatedAscendant - 135 degrees,
 * where the "relocated" ascendant is computed using the birth date/time
 * (converted to Universal Time) but the CURRENT location's latitude and
 * longitude. Natal planet positions only depend on birth time, not
 * birth place, so no birth-place input is required at all.
 */
(function (global) {
  "use strict";

  function toRad(d) { return d * Math.PI / 180; }
  function toDeg(r) { return r * 180 / Math.PI; }
  function norm360(x) { x = x % 360; if (x < 0) x += 360; return x; }

  // ---- Julian Day (Meeus) ----
  function julianDay(y, m, d, hourUT) {
    if (m <= 2) { y -= 1; m += 12; }
    var A = Math.floor(y / 100);
    var B = 2 - A + Math.floor(A / 4);
    var JD0 = Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + B - 1524.5;
    return JD0 + hourUT / 24;
  }

  // ---- Greenwich Mean Sidereal Time, degrees ----
  function gmstDeg(jd) {
    var T = (jd - 2451545.0) / 36525;
    var gmst = 280.46061837 + 360.98564736629 * (jd - 2451545.0) + 0.000387933 * T * T - (T * T * T) / 38710000;
    return norm360(gmst);
  }

  // ---- Mean obliquity of the ecliptic, degrees ----
  function obliquity(T) {
    return 23.439291 - 0.0130042 * T - 0.00000016 * T * T + 0.000000504 * T * T * T;
  }

  // ---- Ascendant ecliptic longitude, degrees (0-360) ----
  function ascendantLongitude(jdUT, latDeg, lonDeg) {
    var T = (jdUT - 2451545.0) / 36525;
    var eps = toRad(obliquity(T));
    var gmst = gmstDeg(jdUT);
    var ramc = toRad(norm360(gmst + lonDeg));
    var phi = toRad(latDeg);
    var y = -Math.cos(ramc);
    var x = Math.sin(ramc) * Math.cos(eps) + Math.tan(phi) * Math.sin(eps);
    // +180 correction: verified against real-world reference readings, the raw
    // atan2 result here lands exactly opposite the correct ascendant.
    return norm360(toDeg(Math.atan2(y, x)) + 180);
  }

  // ---- Sun geometric ecliptic longitude, degrees (Meeus low precision) ----
  function sunLongitude(jd) {
    var T = (jd - 2451545.0) / 36525;
    var L0 = norm360(280.46646 + 36000.76983 * T + 0.0003032 * T * T);
    var M = norm360(357.52911 + 35999.05029 * T - 0.0001537 * T * T);
    var Mr = toRad(M);
    var C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(Mr)
      + (0.019993 - 0.000101 * T) * Math.sin(2 * Mr)
      + 0.000289 * Math.sin(3 * Mr);
    return norm360(L0 + C);
  }

  // ---- Moon ecliptic longitude, degrees (truncated low-precision series) ----
  function moonLongitude(jd) {
    var T = (jd - 2451545.0) / 36525;
    var Lp = norm360(218.3164477 + 481267.88123421 * T);
    var D = norm360(297.8501921 + 445267.1114034 * T);
    var M = norm360(357.5291092 + 35999.0502909 * T);
    var Mp = norm360(134.9633964 + 477198.8675055 * T);
    var F = norm360(93.2720950 + 483202.0175233 * T);
    var Dr = toRad(D), Mr = toRad(M), Mpr = toRad(Mp), Fr = toRad(F);
    var dl = 6.289 * Math.sin(Mpr)
      - 1.274 * Math.sin(2 * Dr - Mpr)
      + 0.658 * Math.sin(2 * Dr)
      - 0.186 * Math.sin(Mr)
      - 0.059 * Math.sin(2 * Dr - 2 * Mpr)
      - 0.057 * Math.sin(2 * Dr - Mr - Mpr)
      + 0.053 * Math.sin(2 * Dr + Mpr)
      + 0.046 * Math.sin(2 * Dr - Mr)
      + 0.041 * Math.sin(Mpr - Mr)
      - 0.035 * Math.sin(Dr)
      - 0.031 * Math.sin(Mpr + Mr)
      - 0.015 * Math.sin(2 * Fr - 2 * Dr)
      + 0.011 * Math.sin(Mpr - 4 * Dr);
    return norm360(Lp + dl);
  }

  // ---- Approximate planetary Keplerian elements (JPL/Standish, J2000) ----
  // [value at J2000, rate per Julian century]
  var ELEMENTS = {
    mercury: { a: [0.38709927, 0.00000037], e: [0.20563593, 0.00001906], I: [7.00497902, -0.00594749], L: [252.25032350, 149472.67411175], peri: [77.45779628, 0.16047689], node: [48.33076593, -0.12534081] },
    venus: { a: [0.72333566, 0.00000390], e: [0.00677672, -0.00004107], I: [3.39467605, -0.00078890], L: [181.97909950, 58517.81538729], peri: [131.60246718, 0.00268329], node: [76.67984255, -0.27769418] },
    earth: { a: [1.00000261, 0.00000562], e: [0.01671123, -0.00004392], I: [-0.00001531, -0.01294668], L: [100.46457166, 35999.37244981], peri: [102.93768193, 0.32327364], node: [0.0, 0.0] },
    mars: { a: [1.52371034, 0.00001847], e: [0.09339410, 0.00007882], I: [1.84969142, -0.00813131], L: [-4.55343205, 19140.30268499], peri: [-23.94362959, 0.44441088], node: [49.55953891, -0.29257343] },
    jupiter: { a: [5.20288700, -0.00011607], e: [0.04838624, -0.00013253], I: [1.30439695, -0.00183714], L: [34.39644051, 3034.74612775], peri: [14.72847983, 0.21252668], node: [100.47390909, 0.20469106] },
    saturn: { a: [9.53667594, -0.00125060], e: [0.05386179, -0.00050991], I: [2.48599187, 0.00193609], L: [49.95424423, 1222.49362201], peri: [92.59887831, -0.41897216], node: [113.66242448, -0.28867794] },
    uranus: { a: [19.18916464, -0.00196176], e: [0.04725744, -0.00004397], I: [0.77263783, -0.00242939], L: [313.23810451, 428.48202785], peri: [170.95427630, 0.40805281], node: [74.01692503, 0.04240589] },
    neptune: { a: [30.06992276, 0.00026291], e: [0.00859048, 0.00005105], I: [1.77004347, 0.00035372], L: [-55.12002969, 218.45945325], peri: [44.96476227, -0.32241464], node: [131.78422574, -0.00508664] },
    pluto: { a: [39.48211675, -0.00031596], e: [0.24882730, 0.00005170], I: [17.14001206, 0.00004818], L: [238.92903833, 145.20780515], peri: [224.06891629, -0.04062942], node: [110.30393684, -0.01183482] }
  };

  function keplerSolve(Mdeg, e) {
    var M = Mdeg % 360; if (M > 180) M -= 360; if (M < -180) M += 360;
    var Mrad = toRad(M);
    var E = Mrad;
    for (var i = 0; i < 12; i++) {
      var dE = (E - e * Math.sin(E) - Mrad) / (1 - e * Math.cos(E));
      E -= dE;
      if (Math.abs(dE) < 1e-9) break;
    }
    return E; // radians
  }

  function heliocentricXYZ(elem, T) {
    var a = elem.a[0] + elem.a[1] * T;
    var e = elem.e[0] + elem.e[1] * T;
    var I = toRad(elem.I[0] + elem.I[1] * T);
    var L = norm360(elem.L[0] + elem.L[1] * T);
    var peri = norm360(elem.peri[0] + elem.peri[1] * T);
    var node = norm360(elem.node[0] + elem.node[1] * T);
    var w = toRad(norm360(peri - node));
    var Om = toRad(node);
    var M = norm360(L - peri);
    var E = keplerSolve(M, e);
    var xp = a * (Math.cos(E) - e);
    var yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
    var cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(Om), sO = Math.sin(Om), cI = Math.cos(I), sI = Math.sin(I);
    var x = (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp;
    var y = (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp;
    return { x: x, y: y };
  }

  function planetGeoLongitude(name, jd) {
    var T = (jd - 2451545.0) / 36525;
    var p = heliocentricXYZ(ELEMENTS[name], T);
    var e = heliocentricXYZ(ELEMENTS.earth, T);
    var x = p.x - e.x, y = p.y - e.y;
    var lon = toDeg(Math.atan2(y, x));
    lon += 1.3970 * T; // approx. precession, J2000 frame -> mean equinox of date
    return norm360(lon);
  }

  var SIGNS = ["Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo", "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces"];

  var ASPECTS = [
    { name: "Conjunction", angle: 0, orb: 6 },
    { name: "Sextile", angle: 60, orb: 4 },
    { name: "Square", angle: 90, orb: 5 },
    { name: "Trine", angle: 120, orb: 5 },
    { name: "Opposition", angle: 180, orb: 6 }
  ];
  var MIDPOINT_ORB = 1.5;

  function angularDiff(a, b) {
    var d = Math.abs(a - b) % 360;
    if (d > 180) d = 360 - d;
    return d;
  }

  function safetyPercent(degInSign) {
    var pct;
    if (degInSign <= 10) pct = (degInSign / 10) * 100;
    else pct = 100 - ((degInSign - 10) / 19) * 100;
    return Math.round(Math.max(0, Math.min(100, pct)));
  }

  function computeReading(jdBirthUT, lat, lon) {
    var ascRelocated = ascendantLongitude(jdBirthUT, lat, lon);
    var rn = norm360(ascRelocated - 135);
    var signIndex = Math.floor(rn / 30);
    var degInSign = rn - signIndex * 30;

    var natal = {
      sun: sunLongitude(jdBirthUT),
      moon: moonLongitude(jdBirthUT),
      mercury: planetGeoLongitude("mercury", jdBirthUT),
      venus: planetGeoLongitude("venus", jdBirthUT),
      mars: planetGeoLongitude("mars", jdBirthUT),
      jupiter: planetGeoLongitude("jupiter", jdBirthUT),
      saturn: planetGeoLongitude("saturn", jdBirthUT),
      uranus: planetGeoLongitude("uranus", jdBirthUT),
      neptune: planetGeoLongitude("neptune", jdBirthUT),
      pluto: planetGeoLongitude("pluto", jdBirthUT)
    };
    var order = ["sun", "moon", "mercury", "venus", "mars", "jupiter", "saturn", "uranus", "neptune", "pluto"];

    var planetAspects = [];
    order.forEach(function (name) {
      var diff = angularDiff(natal[name], rn);
      var best = null;
      ASPECTS.forEach(function (asp) {
        var delta = Math.abs(diff - asp.angle);
        if (delta <= asp.orb) {
          if (!best || delta < best.delta) best = { aspect: asp.name, delta: delta };
        }
      });
      if (best) planetAspects.push({ planet: name, aspect: best.aspect, orb: best.delta });
    });
    planetAspects.sort(function (a, b) { return a.orb - b.orb; });

    var midpointHits = [];
    for (var i = 0; i < order.length; i++) {
      for (var j = i + 1; j < order.length; j++) {
        var lonA = natal[order[i]], lonB = natal[order[j]];
        var diffAB = angularDiff(lonA, lonB);
        var sum = lonA + lonB;
        var m1 = norm360(sum / 2);
        var m2 = norm360(m1 + 180);
        // pick whichever midpoint candidate is actually the short-arc midpoint
        var candidates = (angularDiff(m1, lonA) <= diffAB / 2 + 0.01) ? [m1, m2] : [m2, m1];
        var hitOrb = Math.min(angularDiff(candidates[0], rn), angularDiff(candidates[1], rn));
        if (hitOrb <= MIDPOINT_ORB) {
          midpointHits.push({ a: order[i], b: order[j], orb: hitOrb });
        }
      }
    }
    midpointHits.sort(function (a, b) { return a.orb - b.orb; });

    return {
      rn: rn,
      sign: SIGNS[signIndex],
      degInSign: degInSign,
      pct: safetyPercent(degInSign),
      planetAspects: planetAspects,
      midpointHits: midpointHits
    };
  }

  global.LCAstro = {
    julianDay: julianDay,
    ascendantLongitude: ascendantLongitude,
    sunLongitude: sunLongitude,
    moonLongitude: moonLongitude,
    planetGeoLongitude: planetGeoLongitude,
    computeReading: computeReading
  };
})(window);
