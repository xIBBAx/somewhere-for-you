import * as THREE from "three"
import type { BodyState } from "./universe"
import { names } from "../../personalization"

/** Camera guidance exists only while a real observation station is ready. */
export const observationView = { body: null as string | null }

export type ObservationStop = { title: string; angle: number; line: string }
export type ObservationJourney = { id: string; body: string; title: string; kind: "phase" | "rings"; invitation: string; source: string; stops: ObservationStop[] }
export const OBSERVATION_JOURNEYS: readonly ObservationJourney[] = [
  { id: "moonlight", body: "moon", kind: "phase", title: "The Moon keeps a little light",
    invitation: "Sail around the Moon and watch a full face become a delicate crescent. We change our viewpoint; the Moon does not change shape.",
    source: "NASA Science · Moon phases", stops: [
      { title: "A silver face", angle: 20, line: "Almost the whole sunlit half faces us here. Moonlight is reflected sunlight." },
      { title: "Walk the line of dawn", angle: 90, line: "The terminator divides lunar day from night. Seen from this angle, half the disc is lit." },
      { title: "A cup of light", angle: 150, line: "Most of the illuminated half now faces away from us. The narrow crescent is a change of viewpoint, not Earth's shadow." },
    ] },
  { id: "ring-song", body: "saturn", kind: "rings", title: "The rings that almost disappear",
    invitation: `Let ${names.starborn} carry you above Saturn's rings, down toward their plane, and beneath them. Stay outside the rings and discover how perspective changes a world.`,
    source: "NASA Science · Saturn rings", stops: [
      { title: "An ocean of ice", angle: 25, line: "The rings are countless separate particles, mostly water ice. From above, the enormous disc opens beneath us." },
      { title: "A vanishing ribbon", angle: 2, line: "Close to the ring plane, that wide disc becomes a narrow ribbon. Its apparent width depends on where we look from." },
      { title: "The other side of wonder", angle: -25, line: "We are beneath the same ring plane now. There is no up or down in space itself; these directions are relative to Saturn's pole." },
    ] },
]
export const observationJourney = (id: string): ObservationJourney | undefined => OBSERVATION_JOURNEYS.find(j => j.id === id)

/** Real ephemeris and pole determine every viewpoint. Station geometry is
 * deliberately magical sightseeing, not a claim about real spacecraft orbits. */
export const observationPoint = (journey: ObservationJourney, stop: number, body: BodyState, sun: BodyState, out: THREE.Vector3): THREE.Vector3 => {
  const angle = THREE.MathUtils.degToRad(journey.stops[Math.max(0, Math.min(journey.stops.length - 1, stop))].angle)
  const light = new THREE.Vector3().subVectors(sun.pos, body.pos).normalize()
  const pole = body.pole.clone().normalize()
  let direction: THREE.Vector3
  if (journey.kind === "phase") {
    const tangent = new THREE.Vector3().crossVectors(pole, light)
    if (tangent.lengthSq() < 1e-10) tangent.crossVectors(new THREE.Vector3(1, 0, 0), light)
    if (tangent.lengthSq() < 1e-10) tangent.crossVectors(new THREE.Vector3(0, 0, 1), light)
    direction = light.multiplyScalar(Math.cos(angle)).addScaledVector(tangent.normalize(), Math.sin(angle))
  } else {
    const plane = light.addScaledVector(pole, -light.dot(pole))
    if (plane.lengthSq() < 1e-10) plane.crossVectors(pole, new THREE.Vector3(1, 0, 0))
    if (plane.lengthSq() < 1e-10) plane.crossVectors(pole, new THREE.Vector3(0, 0, 1))
    direction = plane.normalize().multiplyScalar(Math.cos(angle)).addScaledVector(pole, Math.sin(angle))
  }
  // Saturn's outer A/F rings are well inside this radius. No landing, no
  // collision with ring particles, and successive legs stay clear of the body.
  return out.copy(body.pos).addScaledVector(direction.normalize(), body.radius * (journey.kind === "rings" ? 4.5 : 3))
}

export const observationReading = (journey: ObservationJourney, body: BodyState, sun: BodyState, position: THREE.Vector3): { value: number; label: string } => {
  const observer = new THREE.Vector3().subVectors(position, body.pos).normalize()
  if (journey.kind === "rings") return { value: THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(observer.dot(body.pole), -1, 1))), label: "above the ring plane" }
  const light = new THREE.Vector3().subVectors(sun.pos, body.pos).normalize()
  return { value: (1 + THREE.MathUtils.clamp(light.dot(observer), -1, 1)) * 50, label: "of the apparent disc illuminated" }
}

/** Slow enough to stop at a viewpoint without a minimum-sail-speed orbit. */
export const observationSpeedLimit = (distance: number, arrive: number): number =>
  distance <= arrive ? 0 : Math.max(0, (distance - arrive) * 0.55)
