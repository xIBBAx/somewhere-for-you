import * as THREE from "three"
import type { BodyState } from "../universe"
import { bodyAxes } from "./realmState"

/**
 * Real places on the Moon where people and robots have been,
 * placed at their measured selenographic coordinates on the LOLA Moon.
 *
 * Every site's hardware is what is known to be there now: LRO's cameras
 * have photographed the Apollo descent stages, rovers and footpaths, and the
 * Chandrayaan-3 lander. Where the record says something is gone or unknown,
 * the reconstruction follows the record (the Apollo 11 flag lies where the
 * ascent engine's blast knocked it; the Moon Impact Probe left only its
 * crater). One installation is not history: the starlight tricolour is an
 * in-game tribute, and says so.
 *
 * Coordinates: LROC (Lunar Reconnaissance Orbiter Camera, Arizona State
 * University / NASA GSFC) for the Apollo descent stages; ISRO for the
 * Chandrayaan sites. East longitude positive, north latitude positive.
 */

export type SiteKind = "apollo" | "chandrayaan3" | "impact" | "tribute"

export type LunarSite = {
  id: string
  name: string
  /** a short title for the star chart */
  title: string
  kind: SiteKind
  lat: number
  lon: number
  /** the craft or hardware, the date, the people */
  mission: string
  date: string
  /** what is here now, a line at a time (the discovery card) */
  lines: string[]
  /** who the facts come from */
  credit: string
  /** standing flag (true), flag on the ground (false), none (null) */
  flagStanding?: boolean | null
  /** this is history (false only for the tribute) */
  historical: boolean
}

export const LUNAR_SITES: LunarSite[] = [
  {
    id: "apollo11", name: "Tranquility Base", title: "Apollo 11 · Tranquility Base", kind: "apollo",
    lat: 0.67416, lon: 23.47314,
    mission: "Apollo 11 · Lunar Module Eagle · Neil Armstrong, Buzz Aldrin (Michael Collins in orbit)",
    date: "20 July 1969",
    lines: [
      "The first people to walk on another world landed here.",
      "Eagle's descent stage still stands; its ladder leg carries the plaque: “Here men from the planet Earth first set foot upon the Moon, July 1969 A.D. We came in peace for all mankind.”",
      "The flag lies on the dust: Aldrin saw it knocked over by the ascent engine's blast when they left.",
      "Their laser reflector is still in use — observatories on Earth bounce lasers off it to measure the Moon's distance.",
    ],
    credit: "NASA; Apollo Lunar Surface Journal; LROC (ASU/NASA)",
    flagStanding: false,
    historical: true,
  },
  {
    id: "apollo12", name: "Ocean of Storms", title: "Apollo 12 · Ocean of Storms", kind: "apollo",
    lat: -3.0128, lon: -23.4219,
    mission: "Apollo 12 · Lunar Module Intrepid · Pete Conrad, Alan Bean",
    date: "19 November 1969",
    lines: [
      "A pinpoint landing, a short walk from the robot lander Surveyor 3, which the crew visited.",
      "The flag drooped from the day it was planted (its crossbar latch failed), but orbital photographs from 2011 still show its shadow.",
    ],
    credit: "NASA; LROC (ASU/NASA)",
    flagStanding: true,
    historical: true,
  },
  {
    id: "apollo14", name: "Fra Mauro", title: "Apollo 14 · Fra Mauro", kind: "apollo",
    lat: -3.64589, lon: -17.47194,
    mission: "Apollo 14 · Lunar Module Antares · Alan Shepard, Edgar Mitchell",
    date: "5 February 1971",
    lines: [
      "Shepard hit two golf balls here with a club made from a sample tool.",
      "Their laser reflector is still used from Earth.",
      "Nobody knows whether the flag still stands: orbital photographs show no clear shadow of it.",
    ],
    credit: "NASA; LROC (ASU/NASA); ALSJ (Fincannon)",
    flagStanding: null,
    historical: true,
  },
  {
    id: "apollo15", name: "Hadley–Apennine", title: "Apollo 15 · Hadley Rille", kind: "apollo",
    lat: 26.13239, lon: 3.6333,
    mission: "Apollo 15 · Lunar Module Falcon · David Scott, James Irwin",
    date: "30 July 1971",
    lines: [
      "The first crew to drive on the Moon: their Lunar Roving Vehicle is parked nearby.",
      "Scott dropped a hammer and a falcon feather together here — with no air, they hit the ground at the same instant.",
      "Their laser reflector is still used from Earth. Whether the flag still stands is unknown: no clear shadow shows in orbital photographs.",
    ],
    credit: "NASA; LROC (ASU/NASA)",
    flagStanding: null,
    historical: true,
  },
  {
    id: "apollo16", name: "Descartes Highlands", title: "Apollo 16 · Descartes", kind: "apollo",
    lat: -8.9734, lon: 15.5011,
    mission: "Apollo 16 · Lunar Module Orion · John Young, Charles Duke",
    date: "21 April 1972",
    lines: [
      "The only Apollo landing in the bright highlands.",
      "Charles Duke left a photograph of his family here.",
      "The flag still casts a shadow in orbital photographs, its pole leaning.",
    ],
    credit: "NASA; LROC (ASU/NASA)",
    flagStanding: true,
    historical: true,
  },
  {
    id: "apollo17", name: "Taurus–Littrow", title: "Apollo 17 · Taurus–Littrow", kind: "apollo",
    lat: 20.1911, lon: 30.7723,
    mission: "Apollo 17 · Lunar Module Challenger · Gene Cernan, Harrison Schmitt",
    date: "11 December 1972",
    lines: [
      "The last time people walked on the Moon. Schmitt was the only geologist ever to work here.",
      "Their rover is parked about 130 m off. The flag, swung round by the ascent engine's blast, still casts a shadow in orbital photographs.",
    ],
    credit: "NASA; LROC (ASU/NASA)",
    flagStanding: true,
    historical: true,
  },
  {
    id: "chandrayaan3", name: "Shiv Shakti Point", title: "Chandrayaan-3 · Shiv Shakti Point", kind: "chandrayaan3",
    lat: -69.373, lon: 32.319,
    mission: "Chandrayaan-3 · Vikram lander and Pragyan rover · ISRO",
    date: "23 August 2023",
    lines: [
      "India's Vikram lander touched down here: India's first soft landing on the Moon, and the first anywhere near its south pole.",
      "Pragyan rolled down a ramp and drove about 101 m. Its rear wheels carry the ISRO logo and India's national emblem.",
      "Pragyan's laser spectrometer made the first measurements on the surface to confirm sulphur near the south pole.",
      "In early September Vikram fired its engines, rose about 40 cm and set down again a short way off — a hop to show it could.",
      "The place was named Statio Shiv Shakti by the IAU in 2024. 23 August is India's National Space Day.",
    ],
    credit: "ISRO",
    flagStanding: null,
    historical: true,
  },
  {
    id: "mip", name: "Jawahar Point", title: "Chandrayaan-1 · Moon Impact Probe", kind: "impact",
    lat: -89.76, lon: -39.4,
    mission: "Chandrayaan-1 · Moon Impact Probe · ISRO",
    date: "14 November 2008",
    lines: [
      "India's first craft on the Moon struck here, near Shackleton crater by the south pole, sending data all the way down.",
      "The probe carried the Indian tricolour on its sides — India's flag reached the Moon on it. Nothing of it is left to see: it was destroyed on impact, as planned.",
      "This is ISRO's announced location; a 2021 study of orbital photographs places the impact a few kilometres away, on the ridge toward Shackleton.",
    ],
    credit: "ISRO",
    flagStanding: null,
    historical: true,
  },
]

/** Chandrayaan-2's lander (2019), photographed by LRO where it fell. */
LUNAR_SITES.push({
  id: "chandrayaan2", name: "Tiranga Point", title: "Chandrayaan-2 · Tiranga Point", kind: "impact",
  lat: -70.881, lon: 22.784,
  mission: "Chandrayaan-2 · Vikram lander · ISRO",
  date: "6 September 2019",
  lines: [
    "Chandrayaan-2's lander was lost in the last moments of its descent and came down here.",
    "NASA's Lunar Reconnaissance Orbiter found the impact and its scattered debris; an engineer in Chennai, Shanmuga Subramanian, spotted the first piece.",
    "In 2023 India named the spot Tiranga Point — tiranga is the tricolour. Its orbiter is still circling the Moon.",
  ],
  credit: "ISRO; LROC (ASU/NASA)",
  flagStanding: null,
  historical: true,
})

export const ALL_SITES: LunarSite[] = [...LUNAR_SITES]
export const SITE_BY_ID = new Map(ALL_SITES.map((s) => [s.id, s]))

/** A site's body-fixed unit direction (x toward Earth at 0° E, z north). */
export const siteDirection = (s: { lat: number; lon: number }, out: THREE.Vector3): THREE.Vector3 => {
  const la = THREE.MathUtils.degToRad(s.lat), lo = THREE.MathUtils.degToRad(s.lon)
  return out.set(Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la))
}

const _d = new THREE.Vector3()
const _m = new THREE.Matrix3()

/** A site's universe point, `height` (game m) over the Moon's mean radius. False if unknown. */
export const siteUniverse = (id: string, moon: BodyState, height: number, out: THREE.Vector3): boolean => {
  const s = SITE_BY_ID.get(id)
  if (!s) return false
  siteDirection(s, _d)
  // body → game: the transpose of the game → body rows
  _d.applyMatrix3(_m.copy(bodyAxes(moon, _m)).transpose()).normalize()
  out.copy(moon.pos).addScaledVector(_d, moon.radius + height)
  return true
}
