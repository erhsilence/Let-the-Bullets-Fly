import { useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useRef } from 'react'
import GUI from 'lil-gui'

const TRAIN_URL = '/train.glb'

useGLTF.preload(TRAIN_URL)

export default function Train(props) {
  const { scene } = useGLTF(TRAIN_URL)
  const group = useRef(null)
  const base = useRef({
    x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0,
  })
  const motion = useRef({ enabled: true })

  useLayoutEffect(() => {
    const g = group.current
    if (!g) return
    base.current.x = g.position.x
    base.current.y = g.position.y
    base.current.z = g.position.z
    base.current.rx = g.rotation.x
    base.current.ry = g.rotation.y
    base.current.rz = g.rotation.z
  }, [])

  useEffect(() => {
    if (!import.meta.env.DEV) return undefined

    const gui = new GUI({ title: 'Train Debug' })
    const positionFolder = gui.addFolder('Position')
    positionFolder.add(base.current, 'x', -5, 5, 0.01).name('x')
    positionFolder.add(base.current, 'y', -5, 5, 0.01).name('y')
    positionFolder.add(base.current, 'z', -5, 5, 0.01).name('z')
    positionFolder.open()

    const rotationFolder = gui.addFolder('Rotation')
    rotationFolder.add(base.current, 'rx', -Math.PI, Math.PI, 0.001).name('rx')
    rotationFolder.add(base.current, 'ry', -Math.PI, Math.PI, 0.001).name('ry')
    rotationFolder.add(base.current, 'rz', -Math.PI, Math.PI, 0.001).name('rz')
    rotationFolder.open()

    gui.add(motion.current, 'enabled').name('Motion')

    return () => {
      gui.destroy()
    }
  }, [])

  useFrame((state) => {
    const g = group.current
    if (!g) return
    const t = state.clock.elapsedTime
    const o = base.current
    const hasMotion = motion.current.enabled
    const bobY = hasMotion
      ? Math.sin(t * 11) * 0.001 + Math.sin(t * 23.7) * 0.0005
      : 0
    const rollZ = hasMotion ? Math.sin(t * 14.3) * 0.014 : 0
    const pitchX = hasMotion ? Math.sin(t * 17.1) * 0.009 : 0
    const swayX = hasMotion ? Math.sin(t * 9.2) * 0.004 : 0

    g.position.set(o.x + swayX, o.y + bobY, o.z)
    g.rotation.set(o.rx + pitchX, o.ry, o.rz + rollZ)
  })

  return (
    <group ref={group} {...props}>
      <primitive object={scene} />
    </group>
  )
}
