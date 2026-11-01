import { beforeEach, describe, expect, it } from "vitest"
import { isMark, MARK_LIMIT, readMarks, useNavigation, withMark, type Mark } from "../src/state/navigationStore"
import { earthMarkers, UNFOUND_NAME } from "../src/game/navigation/atlasSnapshot"
import { markName, spotGround } from "../src/game/navigation/markPlace"
import { navigationSnapshot } from "../src/game/navigation/navigationState"
import { fastTravelTo, HOME_SPOT } from "../src/game/travel/fastTravel"
import { PLAYABLE_REACH } from "../src/game/travel/safety"
import { HIGHVALE_ARRIVAL } from "../src/world/highvale/highvaleLayout"
import { discoveryRT } from "../src/world/discoveries"
import { characterRT, playerRT } from "../src/game/runtime"
import { groundHeight } from "../src/game/world-layout"

const mark = (n: number, x = n * 10, z = 0): Mark => ({ kind: "earth", id: `mark:${n}`, name: `Mark ${n}`, x, z })

describe("The explorer's own marks on the World map", () => {
  beforeEach(() => { useNavigation.setState({ destination: null, marks: [] }) })

  it("leaves a mark anywhere, heads for it, and keeps each one under its own id", () => {
    const a = useNavigation.getState().mark(120.5, -340.25, markName(120.5, -340.25))
    const b = useNavigation.getState().mark(-5000, 9000, markName(-5000, 9000))
    expect(a.id).not.toBe(b.id)
    expect(isMark(a) && isMark(b)).toBe(true)
    expect(useNavigation.getState().destination).toEqual(b)
    expect(useNavigation.getState().marks.map(m => m.id)).toEqual([b.id, a.id])
    // choosing an older one again is revisiting it, not copying it
    useNavigation.getState().choose(a)
    expect(useNavigation.getState().destination).toEqual(a)
    expect(useNavigation.getState().marks).toHaveLength(2)
  })

  it("forgets a mark, and stops heading for it only if it was the one being followed", () => {
    const a = useNavigation.getState().mark(10, 10, "A"), b = useNavigation.getState().mark(20, 20, "B")
    useNavigation.getState().forget(a.id)
    expect(useNavigation.getState().destination).toEqual(b)
    useNavigation.getState().forget(b.id)
    expect(useNavigation.getState().destination).toBeNull()
    expect(useNavigation.getState().marks).toEqual([])
  })

  it("keeps the newest few, never dropping the one being followed", () => {
    let list: Mark[] = []
    for (let n = 1; n <= MARK_LIMIT; n++) list = withMark(list, mark(n))
    const followed = list[list.length - 1].id
    list = withMark(list, mark(99), followed)
    expect(list).toHaveLength(MARK_LIMIT)
    expect(list[0].id).toBe("mark:99")
    expect(list.some(m => m.id === followed)).toBe(true)
  })

  it("restores saved marks and rejects anything malformed", () => {
    expect(readMarks(JSON.stringify([mark(1), mark(2)]))).toEqual([mark(1), mark(2)])
    expect(readMarks(JSON.stringify([mark(1), mark(1), { kind: "earth", id: "home", name: "x", x: 0, z: 0 }, { kind: "earth", id: "mark:3", name: "", x: 0, z: 0 }]))).toEqual([mark(1)])
    for (const raw of [null, "", "{", "{}", "null", "x".repeat(4001), JSON.stringify([{ kind: "earth", id: "mark:1", name: "M", x: Infinity, z: 0 }])]) expect(readMarks(raw)).toEqual([])
  })

  it("names a mark by the places the explorer knows, with a true distance and direction", () => {
    expect(markName(HOME_SPOT.x, HOME_SPOT.z - 10)).toBe("Marked spot by home")
    expect(markName(HOME_SPOT.x + 1500, HOME_SPOT.z)).toMatch(/^Marked spot · 1\.5 km E of home$/)
    expect(markName(HIGHVALE_ARRIVAL.x, HIGHVALE_ARRIVAL.z)).toBe("Marked spot in the hills of Devdar Valley")
  })

  it("shows the marks among the Earth markers, as marks", () => {
    const a = useNavigation.getState().mark(4321, -1234, "Far")
    const found = earthMarkers(0, 0, 200).find(m => m.destination.id === a.id)
    expect(found).toMatchObject({ glyph: "mark", x: 4321, z: -1234 })
  })

  it("never names a generated landmark before it is found", () => {
    const list = earthMarkers(0, 0, 2400)
    const landmarks = list.filter(m => m.destination.id.startsWith("lm:"))
    expect(landmarks.length).toBeGreaterThan(0)
    for (const m of landmarks) {
      if (discoveryRT.found.has(m.destination.id)) expect(m.glyph).toBe("place")
      else expect(m).toMatchObject({ glyph: "unknown", destination: { name: UNFOUND_NAME } })
    }
  })

  it("arrives at a mark within a few strides, and says when it is just below a flyer", () => {
    characterRT.active = "explorer"
    playerRT.pos.set(100, groundHeight(100, 0), 0)
    const near = navigationSnapshot(mark(1, 105, 0), 180)
    expect(near.arrived).toBe(true)
    const named = navigationSnapshot({ kind: "earth", id: "somewhere", name: "Somewhere", x: 105, z: 0 }, 180)
    expect(named.arrived).toBe(false)
  })

  it("refuses fast travel to the uncharted wilds, rather than setting her down somewhere else", () => {
    const reason = fastTravelTo({ x: HOME_SPOT.x + PLAYABLE_REACH + 2000, z: HOME_SPOT.z, name: "Far mark" }, () => {})
    expect(reason).toMatch(/uncharted/)
    expect(spotGround(HOME_SPOT.x + PLAYABLE_REACH + 2000, HOME_SPOT.z).uncharted).toBe(true)
  })
})
