import { Diyas } from "./Diyas"
import { Kites } from "./Kites"
import { Peacocks } from "./Peacocks"
import { Rangoli } from "./Rangoli"
import { Torans } from "./Torans"

/** The small things that make home feel like home: all procedural, no extra downloads. */
export const IndiaDetails = (): React.ReactElement => (
  <group name="india-details">
    <Rangoli />
    <Diyas />
    <Torans />
    <Kites />
    <Peacocks />
  </group>
)
