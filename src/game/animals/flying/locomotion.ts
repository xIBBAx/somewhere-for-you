import type { FlightPoint } from "./primitives"
import type { FlightIndividual } from "./state"

const clamp = (v: number, low: number, high: number) => Math.max(low, Math.min(high, v))
const smooth = (from: number, to: number, rate: number, dt: number) => from + (to - from) * (1 - Math.exp(-rate * dt))

/**
 * Bounded velocity tracking for the stylized flight envelopes. This is not CFD.
 * Goal selection supplies a ground-relative velocity after wind compensation and
 * obstacle planning. Changing a goal cannot rewrite position or velocity.
 */
export function integrateFlight(agent: FlightIndividual, desiredVelocity: FlightPoint, dt: number): void {
  const { flight } = agent.profile
  const velocity = agent.velocity
  const oldX = velocity.x, oldY = velocity.y, oldZ = velocity.z
  const oldSpeed = Math.hypot(oldX, oldY, oldZ)
  const desiredSpeed = Math.hypot(desiredVelocity.x, desiredVelocity.y, desiredVelocity.z)
  const scale = desiredSpeed > flight.burst ? flight.burst / desiredSpeed : 1
  let ax = (desiredVelocity.x * scale - oldX) / 0.22
  let ay = (clamp(desiredVelocity.y * scale, -flight.climb, flight.climb) - oldY) / 0.22
  let az = (desiredVelocity.z * scale - oldZ) / 0.22
  // At speed, bound lateral force by the species turn envelope. Longitudinal
  // braking remains available even for a directly opposing escape target.
  if (oldSpeed > 0.05) {
    const longitudinal = (ax * oldX + ay * oldY + az * oldZ) / (oldSpeed * oldSpeed)
    const lx = ax - oldX * longitudinal, ly = ay - oldY * longitudinal, lz = az - oldZ * longitudinal
    const lateral = Math.hypot(lx, ly, lz)
    const lateralLimit = oldSpeed * flight.turnRate
    if (lateral > lateralLimit) {
      const f = lateralLimit / lateral
      ax = oldX * longitudinal + lx * f
      ay = oldY * longitudinal + ly * f
      az = oldZ * longitudinal + lz * f
    }
  }
  const magnitude = Math.hypot(ax, ay, az)
  const limit = desiredSpeed < oldSpeed ? flight.braking : flight.acceleration
  if (magnitude > limit) { const f = limit / magnitude; ax *= f; ay *= f; az *= f }
  // Trapezoidal position integration stays continuous under braking and turns.
  velocity.x += ax * dt; velocity.y += ay * dt; velocity.z += az * dt
  agent.acceleration.x = ax; agent.acceleration.y = ay; agent.acceleration.z = az
  agent.previousPosition.x = agent.position.x
  agent.previousPosition.y = agent.position.y
  agent.previousPosition.z = agent.position.z
  const dx = (oldX + velocity.x) * 0.5 * dt
  const dy = (oldY + velocity.y) * 0.5 * dt
  const dz = (oldZ + velocity.z) * 0.5 * dt
  agent.position.x += dx; agent.position.y += dy; agent.position.z += dz
  agent.distanceTravelled += Math.hypot(dx, dy, dz)

  const horizontal = Math.hypot(velocity.x, velocity.z)
  const speed = Math.hypot(horizontal, velocity.y)
  const pose = agent.pose
  if (horizontal > 0.06) {
    const target = Math.atan2(velocity.x, velocity.z)
    const difference = Math.atan2(Math.sin(target - pose.heading), Math.cos(target - pose.heading))
    pose.heading += clamp(difference, -flight.turnRate * dt, flight.turnRate * dt)
  }
  const lateralAcceleration = horizontal > 0.06 ? (ax * velocity.z - az * velocity.x) / horizontal : 0
  const landing = agent.mode === "approach" || agent.mode === "contact"
  const flightPitch = Math.atan2(velocity.y, Math.max(0.12, horizontal))
  pose.pitch = smooth(pose.pitch, clamp(flightPitch + (landing ? (1 - Math.min(1, speed / flight.cruise)) * 0.6 : 0), -0.65, 0.9), 8, dt)
  pose.bank = smooth(pose.bank, clamp(-Math.atan2(lateralAcceleration, 9.81), -0.95, 0.95), 7, dt)
  const powered = agent.mode !== "glide" && agent.mode !== "bound"
  const effort = powered ? clamp(0.3 + speed / flight.cruise * 0.25 + Math.max(0, ay) / flight.acceleration * 0.3 + Math.max(0, velocity.y) / flight.climb * 0.25, 0, 1) : 0
  pose.effort = smooth(pose.effort, effort, 9, dt)
  pose.wingPhase = (pose.wingPhase + Math.PI * 2 * flight.wingHz * (0.75 + pose.effort * 0.35) * dt) % (Math.PI * 2)
  pose.wingFold = smooth(pose.wingFold, agent.mode === "bound" ? 0.85 : 0, 12, dt)
  pose.feet = smooth(pose.feet, landing ? 1 : 0, 10, dt)
  pose.tailFan = smooth(pose.tailFan, landing ? 0.85 : Math.min(0.6, Math.abs(pose.bank) * 0.6), 8, dt)
}

/** Braking-distance arrival; a moving support supplies its velocity at contact. */
export function arrivalVelocity(agent: FlightIndividual, target: FlightPoint, targetVelocity: FlightPoint,
  clearance: number, cruise: number, out: FlightPoint): void {
  const dx = target.x - agent.position.x, dy = target.y - agent.position.y, dz = target.z - agent.position.z
  const distance = Math.hypot(dx, dy, dz)
  // The final gain is critically damped with the velocity tracker (tau=.22).
  // A faster gain overshoots the perch even with a correct stopping-distance cap.
  const speed = Math.min(cruise, Math.sqrt(2 * agent.profile.flight.braking * Math.max(0, distance - clearance)), Math.max(0, distance - clearance) * 1.05)
  const scale = distance > 1e-8 ? speed / distance : 0
  out.x = dx * scale + targetVelocity.x
  out.y = dy * scale + targetVelocity.y
  out.z = dz * scale + targetVelocity.z
}
