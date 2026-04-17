import { Clone, useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useCallback, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

import {
  installRailwayTrackFade,
} from '../shaders/railwayTrackFade.js'

const RAILWAY_URL = '/railway.glb'

useGLTF.preload(RAILWAY_URL)

/**
 * Circular arc with chord from (0,0) to (L,0) on the X axis, bulging toward +Z
 * (with center on the XZ plane).
 * `sagitta` is the arc height at the chord midpoint.
 */
function createTrackFadeUniforms(fadeWidth) {
  return {
    uFadeWidth: { value: fadeWidth },
    uArcBase: { value: 0 },
    uArcDelta: { value: 0 },
    uOrigin: { value: new THREE.Vector3() },
    uTangent: { value: new THREE.Vector3() },
    uSegLen: { value: 1 },
  }
}

/**
 * @param {THREE.Group} group
 * @param {object} cfg
 * @param {number} index
 * @param {number} scroll
 * @param {boolean} infinite
 * @param {number} fadeWidth
 */
function updateTrackFadeUniforms(group, cfg, index, scroll, infinite, fadeWidth) {
  const uniforms = group?.userData?.railFadeUniforms
  if (!uniforms || !group || !cfg) return

  uniforms.uFadeWidth.value = fadeWidth

  const { curve, totalLen, segmentLength, count, localForward } = cfg
  const fwd = localForward

  let sOnArc
  let sForFade
  const fadeLen = Math.max(count * segmentLength, 1e-4)
  if (infinite) {
    const period = count * segmentLength
    let s = index * segmentLength - scroll
    s = THREE.MathUtils.euclideanModulo(s, period)
    sOnArc = THREE.MathUtils.euclideanModulo(s, totalLen)
    sForFade = THREE.MathUtils.euclideanModulo(s, fadeLen)
  } else {
    sOnArc = Math.min(index * segmentLength, totalLen - 1e-5)
    sForFade = Math.min(index * segmentLength, fadeLen - 1e-5)
  }

  const paramU = Math.min(sOnArc / totalLen, 1 - 1e-6)
  const pos = curve.getPointAt(paramU)
  const tangent = curve.getTangentAt(paramU)
  const tXZ = tangent.clone()
  tXZ.y = 0
  if (tXZ.lengthSq() < 1e-10) tXZ.copy(fwd).normalize()
  else tXZ.normalize()

  const parent = group.parent
  uniforms.uArcBase.value = sForFade / fadeLen
  uniforms.uArcDelta.value = segmentLength / fadeLen
  uniforms.uOrigin.value.copy(pos)
  if (parent) parent.localToWorld(uniforms.uOrigin.value)
  uniforms.uTangent.value.copy(tXZ)
  if (parent)
    uniforms.uTangent.value.transformDirection(parent.matrixWorld)
  uniforms.uSegLen.value =
    segmentLength * (parent ? parent.matrixWorld.getMaxScaleOnAxis() : 1)
}

function RailwayTrackPiece({
  scene,
  index,
  infinite,
  fadeWidth,
  config,
  configRef,
  scrollRef,
  position,
  quaternion,
  setItemRef,
}) {
  const rootRef = useRef(null)

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return

    const uniforms = createTrackFadeUniforms(fadeWidth)
    root.userData.railFadeUniforms = uniforms

    const disposables = []
    root.traverse((o) => {
      if (!o.isMesh) return
      const mats = Array.isArray(o.material) ? o.material : [o.material]
      const next = mats.map((m) => {
        const c = m.clone()
        installRailwayTrackFade(c, uniforms)
        disposables.push(c)
        return c
      })
      o.material = next.length === 1 ? next[0] : next
    })

    const cfg = configRef.current
    if (cfg)
      updateTrackFadeUniforms(
        root,
        cfg,
        index,
        infinite ? scrollRef.current : 0,
        infinite,
        fadeWidth,
      )

    return () => {
      for (const m of disposables) m.dispose()
      delete root.userData.railFadeUniforms
    }
  }, [scene, fadeWidth, index, infinite, configRef, scrollRef])

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root || !config || infinite) return
    updateTrackFadeUniforms(root, config, index, 0, false, fadeWidth)
  }, [infinite, index, position, quaternion, config, fadeWidth])

  return (
    <group
      ref={(el) => {
        rootRef.current = el
        setItemRef(index, el)
      }}
      position={position}
      quaternion={quaternion}
    >
      <Clone object={scene} />
    </group>
  )
}

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
 * @param {number} [fadeWidth=0.12] 弧长归一化 [0,1] 上两端淡出宽度，越大透明过渡越长。
 */
export default function Railway({
  curveLength = 14,
  bend = 5,
  segmentLength: segmentLengthProp,
  maxSegments = 8,
  infinite = false,
  scrollSpeed = 3.2,
  fadeWidth = 0.12,
  ...props
}) {
  const { scene } = useGLTF(RAILWAY_URL)

  const scrollRef = useRef(0)
  const itemRefs = useRef([])
  const configRef = useRef(null)
  const scrollSpeedRef = useRef(scrollSpeed)
  scrollSpeedRef.current = scrollSpeed
  const fadeWidthRef = useRef(fadeWidth)
  fadeWidthRef.current = fadeWidth

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
      updateTrackFadeUniforms(g, cfg, i, scroll, true, fadeWidthRef.current)
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

  const setItemRef = useCallback((i, el) => {
    if (el) itemRefs.current[i] = el
    else delete itemRefs.current[i]
  }, [])

  return (
    <group {...props}>
      {infinite
        ? Array.from({ length: count }, (_, i) => (
          <RailwayTrackPiece
            key={i}
            scene={scene}
            index={i}
            infinite
            fadeWidth={fadeWidth}
            config={config}
            configRef={configRef}
            scrollRef={scrollRef}
            position={[0, 0, 0]}
            quaternion={[0, 0, 0, 1]}
            setItemRef={setItemRef}
          />
        ))
        : staticPlacements.map(({ pos, quat }, i) => (
          <RailwayTrackPiece
            key={i}
            scene={scene}
            index={i}
            infinite={false}
            fadeWidth={fadeWidth}
            config={config}
            configRef={configRef}
            scrollRef={scrollRef}
            position={[pos.x, pos.y, pos.z]}
            quaternion={quat}
            setItemRef={setItemRef}
          />
        ))}
    </group>
  )
}
