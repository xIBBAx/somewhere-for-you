import { story } from "../content/story"
import { HighvaleRoot } from "../world/highvale/render/HighvaleRoot"
import { useRef, type ReactNode } from "react"
import { useFrame } from "@react-three/fiber"
import * as THREE from "three"
import { Lighting } from "./environment/Lighting"
import { HomeRegion } from "./environment/HomeRegion"
import { Vegetation } from "./environment/Vegetation"
import { Clouds } from "./environment/Clouds"
import { SkyStars } from "./environment/SkyStars"
import { Animals } from "./environment/Animals"
import { CornerCafe } from "./environment/CornerCafe"
import { LittleStudio } from "./environment/LittleStudio"
import { TrainingCorner } from "./environment/TrainingCorner"
import { CatGarden } from "./environment/CatGarden"
import { RainSpot } from "./environment/RainSpot"
import { PathAhead } from "./environment/PathAhead"
import { FinaleGarden } from "./environment/FinaleGarden"
import { ExplorerCharacter } from "./characters/ExplorerCharacter"
import { CompanionCharacter } from "./characters/CompanionCharacter"
import { CharacterSwitch } from "./characters/characterSwitch"
import { Together } from "./together/Together"
import { Activities } from "./activities/Activities"
import { PhotoMode } from "./activities/photo"
import { CompanionCat } from "./characters/CompanionCat"
import { FollowCamera } from "./camera/FollowCamera"
import { MemoryAnchors } from "./interactions/MemoryAnchors"
import { InteractionManager, FinaleGate } from "./interactions/InteractionManager"
import { Secrets } from "./interactions/Secrets"
import { FinaleDirector } from "./interactions/FinaleDirector"
import { MemoryStopProps } from "./environment/MemoryStopProps"
import { Sparkles } from "./particles/sparkles"
import { StarCollect } from "./particles/StarCollect"
import { SignBoard } from "./environment/props"
import { groundHeight } from "./world-layout"
import { PathLanterns } from "./environment/PathLanterns"
import { MeadowScatters } from "./environment/MeadowScatters"
import { WeatherSystem } from "./weather/WeatherSystem"
import { GlobalRain } from "./environment/GlobalRain"
import { Snowfall } from "./environment/Snowfall"
import { Rainbow } from "./environment/Rainbow"
import { Fireworks } from "./environment/Fireworks"
import { GroundFog } from "./environment/GroundFog"
import { HeatHaze } from "./environment/HeatHaze"
import { Fireflies } from "./environment/Fireflies"
import { Fair } from "./environment/Fair"
import { LivingTreeDetails } from "./environment/LivingTreeDetails"
import { SkyLife } from "./environment/SkyLife"
import { WindborneLeaves } from "./environment/WindborneLeaves"
import { GulmoharTrees } from "./environment/GulmoharTrees"
import { IndiaDetails } from "./environment/india/IndiaDetails"
import { Dandelions } from "./environment/Dandelions"
import { FamousRarePlants } from "./environment/FamousRarePlants"
import { DeerSystem } from "./deer/DeerSystem"
import { HorseSystem } from "./horses/HorseSystem"
import { SafetyNet } from "./travel/SafetyNet"
import { Monkeys } from "./environment/Monkeys"
import { Insects } from "./environment/Insects"
import { TreeFairyLights } from "./environment/TreeFairyLights"
import { Waterfall } from "./environment/Waterfall"
import { CinematicJourney } from "./CinematicJourney"
import { worldRT } from "./runtime"
import { WorldRoot } from "../world/render/WorldRoot"
import { WaterFx } from "../world/render/waterFx"
import { HubGate } from "./hubGate"
import { LightPool } from "./lightPool"
import { StreamedTerrain } from "../world/render/StreamedTerrain"
import { FarTerrain } from "../world/render/FarTerrain"
import { HorizonLands } from "../world/render/HorizonLands"
import { LakeMist } from "../world/render/LakeMist"
import { WorldScatter } from "../world/render/WorldScatter"
import { GrassField } from "../world/render/GrassField"
import { Discoveries } from "../world/render/Discoveries"
import { Wildlife } from "../world/wildlife/Wildlife"
import { WorldLife } from "../world/life/WorldLife"
import { StreamedWater } from "../world/render/StreamedWater"
import { AquaticLife } from "../world/aquatic/AquaticLife"
import { GroundSystem } from "./environment/ground/GroundSystem"
import { SoundscapeDirector } from "./audio/SoundscapeDirector"
import { CelestialSky } from "./celestial/render/CelestialSky"
import { CelestialController } from "./celestial/CelestialController"
import { homeGroundHidden, spaceRT } from "./celestial/spaceState"
import { RealmGround } from "./celestial/realm/RealmGround"
import { LunarScene } from "./celestial/realm/LunarScene"
import { StarVeil } from "./celestial/StarVeil"
import { SpaceCats } from "./celestial/spaceCats/SpaceCats"
import { WorldWonders } from "./celestial/wonders/WorldWonders"
import { PegasusTrail } from "./pegasus/PegasusTrail"
import { OverdriveFX } from "./pegasus/OverdriveFX"
import { DashFX } from "./pegasus/DashFX"
import { PegasusWake } from "./pegasus/WakeFX"
import { AscentFX } from "./pegasus/AscentFX"
import { ClimbMist } from "./pegasus/ClimbMistFX"
import { WarpCorridor } from "./celestial/WarpCorridor"
import { GroundDashFX } from "./horses/GroundDashFX"
import { HeroFX } from "./vfx/HeroFX"
import { RingField } from "./celestial/rings/RingField"
import { ReentryFX } from "./celestial/ReentryFX"
import { SpaceDust } from "./celestial/SpaceDust"
import { PegasusDownwash } from "./pegasus/downwash"
import { ridingCelestial } from "./celestial/CelestialController"
import { StarNookPrompt } from "./celestial/spaceCats/StarNookPrompt"
import { StarNook } from "./environment/StarNook"
import { Dragon } from "./dragon/Dragon"
import { SkyWhales } from "./skywhales/SkyWhales"

/**
 * Mount order matters: player updates first, cat second, camera last —
 * R3F runs useFrame callbacks in subscription (mount) order.
 */
export const World = ({ cinematic }: { cinematic: boolean }): React.ReactElement => {
  return (
    <WorldRoot>
      <CharacterSwitch />
      <Together />
      <WorldReveal cinematic={cinematic} name="streamed-world-reveal" ground>
        <HorizonLands />
        <FarTerrain />
        <StreamedTerrain />
        <StreamedWater />
        <LakeMist />
        <AquaticLife />
        <GrassField />
      </WorldReveal>
      {cinematic && <CinematicJourney />}
      <WeatherSystem />
      <WorldReveal cinematic={cinematic}>
        <Lighting />
        <LightPool />
        <SkyStars />
        <EarthOnly>
          <Clouds />
          <SkyLife />
          <GlobalRain />
          <Snowfall />
          <Rainbow />
          <Fireworks />
        </EarthOnly>
        <HubGate>
          <Fireflies />
          <HomeRegion />
          <Waterfall />
          <Fair />
          <PathLanterns />
          <MeadowScatters />
          <Vegetation />
          <GulmoharTrees />
          <IndiaDetails />
          <TreeFairyLights />
          <Dandelions />
          <FamousRarePlants />
          <group userData={{ dynamic: true }}>
            <Insects />
            <LivingTreeDetails />
            <WindborneLeaves />
          </group>
          <CornerCafe />
          <LittleStudio />
          <TrainingCorner />
          <CatGarden />
          <StarNook />
          <RainSpot />
          <PathAhead />
          <FinaleGarden />
          <group name="living-home-animals" userData={{ dynamic: true }}>
            <Animals />
            <Monkeys />
          </group>
          <Secrets />
          <MemoryStopProps />
          <GameplayReveal cinematic={cinematic}>
            <MemoryAnchors />
          </GameplayReveal>
          <StartSign />
          <HeatHaze />
          <GroundFog />
        </HubGate>
        {/* simulation order: The explorer → cat → camera */}
        <ExplorerCharacter />
        <CompanionCharacter />
        <HeroFX />
        <EarthOnly>
          <WaterFx />
          <Wildlife />
          <StarNookPrompt />
        </EarthOnly>
        <HorseSystem />
        <SafetyNet />
        <EarthOnly>
          <DeerSystem />
          <WorldLife />
          <Discoveries />
          <HighvaleRoot />
        </EarthOnly>
        <SoundscapeDirector />
        <CompanionCat />
        <Dragon />
        <SkyWhales />
        <EarthOnly>
          <GroundSystem />
        </EarthOnly>
        <Sparkles />
        <StarCollect />
        <FinaleDirector />
      </WorldReveal>
      <FollowCamera cinematic={cinematic} />
      {/* the real sky beyond the air, placed from the final camera */}
      <WorldReveal cinematic={cinematic} name="celestial-reveal">
        <CelestialSky />
        <CelestialController />
        <RealmGround />
        <LunarScene />
        <StarVeil />
        <SpaceCats />
        <WorldWonders />
        <PegasusTrail />
        <DashFX />
        <OverdriveFX />
        <GroundDashFX />
        <PegasusWake />
        <PegasusDownwash />
        <AscentFX pilot={ridingCelestial} />
        <ClimbMist />
        <SpaceDust />
        <WarpCorridor pilot={ridingCelestial} />
        <RingField pilot={ridingCelestial} />
        <ReentryFX pilot={ridingCelestial} />
      </WorldReveal>
      {/* Compact vegetation after the final camera transform, including turns
          and teleports, so newly visible instances arrive in the same frame. */}
      <WorldReveal cinematic={cinematic} name="scatter-world-reveal" ground>
        <WorldScatter />
      </WorldReveal>
      <Activities />
      <PhotoMode />
      <InteractionManager />
      <FinaleGate />
    </WorldRoot>
  )
}

/** Keep the actual world warm/running, but reveal it only under the cloud mask. */
const WorldReveal = ({
  cinematic,
  children,
  name = "world-reveal",
  ground = false,
}: {
  cinematic: boolean
  children: ReactNode
  name?: string
  /** home's terrain: not drawn from orbit or on another world */
  ground?: boolean
}): React.ReactElement => {
  const group = useRef<THREE.Group>(null)
  useFrame(() => {
    if (group.current) {
      group.current.visible = (!cinematic || worldRT.introProgress >= 0.495) && !(ground && homeGroundHidden())
    }
  })
  return <group ref={group} name={name} visible={!cinematic}>{children}</group>
}

/**
 * Home's own weather, sky life and creatures: not drawn while the riders
 * stand on another world (the Moon has no birds, rain or grass).
 */
const EarthOnly = ({ children }: { children: ReactNode }): React.ReactElement => {
  const group = useRef<THREE.Group>(null)
  useFrame(() => {
    if (group.current) group.current.visible = spaceRT.realm === "earth"
  })
  return <group ref={group}>{children}</group>
}

/** Gameplay affordances arrive with the HUD, never inside the character reveal. */
const GameplayReveal = ({
  cinematic,
  children,
}: {
  cinematic: boolean
  children: ReactNode
}): React.ReactElement => <group visible={!cinematic}>{children}</group>

const StartSign = (): React.ReactElement => (
  <SignBoard
    text={story.title}
    position={[-2.35, groundHeight(-2.35, 23.35), 23.35]}
    rotationY={0.34}
    width={1.7}
  />
)
