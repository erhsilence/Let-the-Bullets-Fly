import { useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useLayoutEffect, useRef } from 'react'

const TRAIN_URL = '/train.glb'

useGLTF.preload(TRAIN_URL)

export default function Train(props) {
  const { scene } = useGLTF(TRAIN_URL)
  const group = useRef(null)
  const base = useRef({
    x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0,
  })

  useLayoutEffect(() => {
    const g = group.current
    if (!g) return
    base.current = {
      x: g.position.x,
      y: g.position.y,
      z: g.position.z,
      rx: g.rotation.x,
      ry: g.rotation.y,
      rz: g.rotation.z,
    }
  }, [])

  useFrame((state) => {
    const g = group.current
    if (!g) return
    const t = state.clock.elapsedTime
    const o = base.current
    const bobY =
      Math.sin(t * 11) * 0.001 + Math.sin(t * 23.7) * 0.0005
    const rollZ = Math.sin(t * 14.3) * 0.014
    const pitchX = Math.sin(t * 17.1) * 0.009
    const swayX = Math.sin(t * 9.2) * 0.004

    g.position.set(o.x + swayX, o.y + bobY, o.z)
    g.rotation.set(o.rx + pitchX, o.ry, o.rz + rollZ)
  })

  return (
    <group ref={group} {...props}>
      <primitive object={scene} />
    </group>
  )
}
