import { Clone, useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useCallback, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

const RAILWAY_URL = '/railway.glb'

useGLTF.preload(RAILWAY_URL)

/**
 * Circular arc with chord from (0,0) to (L,0) on the X axis, bulging toward +Z
 * (with center on the XZ plane).
 * `sagitta` is the arc height at the chord midpoint.
 */
class RailArcCurve extends THREE.Curve {
  constructor(L, sagitta) {
    super()
    const s = Math.max(sagitta, 1e-4)
    const mid = L * 0.5
    this.cx = mid
    this.cz = (s * s - mid * mid) / (2 * s)
    this.R = Math.sqrt(mid * mid + this.cz * this.cz)

    const phiA = Math.atan2(0 - this.cz, 0 - this.cx)
    const phiB = Math.atan2(0 - this.cz, L - this.cx)
    const deltas = [
      phiB - phiA,
      phiB - phiA + 2 * Math.PI,
      phiB - phiA - 2 * Math.PI,
    ]
    let bestD = deltas[0]
    let bestMidZ = -Infinity
    for (const d of deltas) {
      const zMid = this.cz + this.R * Math.sin(phiA + 0.5 * d)
      if (zMid > bestMidZ) {
        bestMidZ = zMid
        bestD = d
      }
    }
    this.phi0 = phiA
    this.phi1 = phiA + bestD
  }

  getPoint(t, optionalTarget = new THREE.Vector3()) {
    const phi = THREE.MathUtils.lerp(this.phi0, this.phi1, t)
    return optionalTarget.set(
      this.cx + this.R * Math.cos(phi),
      0,
      this.cz + this.R * Math.sin(phi),
    )
  }
}

/**
 * @param {number} [curveLength=14] Chord length of the main track along +X (world units).
 * @param {number} [bend=5] Arc sagitta (midpoint-to-arc distance toward +Z); larger means sharper bend.
 * @param {number} [segmentLength] Length per segment; if omitted, use model bounding-box size along forward axis.
 * @param {number} [maxSegments=12] Upper cap to avoid spawning too many segments when model data is abnormal.
 * @param {boolean} [infinite=false] If true, segments loop backward along arc length (making the train appear to move forward).
 * @param {number} [scrollSpeed=3.2] Backward scrolling speed along arc length in infinite mode (world units/second).
 */
export default function Railway({
  curveLength = 14,
  bend = 5,
  segmentLength: segmentLengthProp,
  maxSegments = 12,
  infinite = false,
  scrollSpeed = 3.2,
  ...props
}) {
  const { scene } = useGLTF(RAILWAY_URL)

  const scrollRef = useRef(0)
  const itemRefs = useRef([])
  const configRef = useRef(null)
  const scrollSpeedRef = useRef(scrollSpeed)
  scrollSpeedRef.current = scrollSpeed

  const config = useMemo(() => {
    scene.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(scene)
    const size = box.getSize(new THREE.Vector3())

    const localForward = new THREE.Vector3(0, 0, 1)
    let segmentLength = Math.max(size.z, 0.01)
    if (size.x >= size.z) {
      localForward.set(1, 0, 0)
      segmentLength = Math.max(size.x, 0.01)
    }

    if (segmentLengthProp != null && segmentLengthProp > 1e-6)
      segmentLength = segmentLengthProp

    const curve = new RailArcCurve(curveLength, bend)
    const totalLen = curve.getLength()
    const count = Math.max(
      1,
      Math.min(maxSegments, Math.floor(totalLen / segmentLength)),
    )

    const fwd = localForward.clone().normalize()
    const staticPlacements = []

    for (let i = 0; i < count; i++) {
      const d = Math.min(i * segmentLength, totalLen - 1e-5)
      const u = d / totalLen
      const pos = curve.getPointAt(u)
      const tangent = curve.getTangentAt(u)
      const tXZ = tangent.clone()
      tXZ.y = 0
      if (tXZ.lengthSq() < 1e-10)
        tXZ.set(fwd.x, 0, fwd.z).normalize()
      else tXZ.normalize()

      const quat = new THREE.Quaternion().setFromUnitVectors(fwd, tXZ)
      staticPlacements.push({ pos, quat })
    }

    return {
      curve,
      totalLen,
      segmentLength,
      count,
      localForward: fwd,
      staticPlacements,
    }
  }, [scene, bend, curveLength, maxSegments, segmentLengthProp])

  configRef.current = config

  const applyScroll = useCallback((scroll) => {
    const cfg = configRef.current
    if (!cfg) return
    const { curve, totalLen, segmentLength, count, localForward } = cfg
    const period = count * segmentLength
    const fwd = localForward

    for (let i = 0; i < count; i++) {
      const g = itemRefs.current[i]
      if (!g) continue

      let s = i * segmentLength - scroll
      s = THREE.MathUtils.euclideanModulo(s, period)
      const sOnArc = THREE.MathUtils.euclideanModulo(s, totalLen)
      const u = Math.min(sOnArc / totalLen, 1 - 1e-6)

      const pos = curve.getPointAt(u)
      const tangent = curve.getTangentAt(u)
      const tXZ = tangent.clone()
      tXZ.y = 0
      if (tXZ.lengthSq() < 1e-10)
        tXZ.set(fwd.x, 0, fwd.z).normalize()
      else tXZ.normalize()

      g.position.copy(pos)
      g.quaternion.setFromUnitVectors(fwd, tXZ)
    }
  }, [])

  useLayoutEffect(() => {
    if (!infinite) return
    applyScroll(scrollRef.current)
  }, [infinite, config, applyScroll])

  useFrame((_, delta) => {
    if (!infinite) return
    scrollRef.current += scrollSpeedRef.current * delta
    applyScroll(scrollRef.current)
  })

  const { staticPlacements, count } = config

  return (
    <group {...props}>
      {infinite
        ? Array.from({ length: count }, (_, i) => (
          <group
            key={i}
            ref={(el) => {
              if (el) itemRefs.current[i] = el
            }}
          >
            <Clone object={scene} />
          </group>
        ))
        : staticPlacements.map(({ pos, quat }, i) => (
          <group key={i} position={[pos.x, pos.y, pos.z]} quaternion={quat}>
            <Clone object={scene} />
          </group>
        ))}
    </group>
  )
}
