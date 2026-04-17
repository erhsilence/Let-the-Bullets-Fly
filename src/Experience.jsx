import { OrbitControls } from '@react-three/drei'
import Railway from './model/railway.jsx'
import Train from './model/train.jsx'

export default function Experience() {
    return <>

        <OrbitControls makeDefault />

        <directionalLight position={[1, 2, 3]} intensity={4.5} />
        <ambientLight intensity={1.5} />

        <Railway infinite scrollSpeed={0.8} />
        <Train
            position={[2.98, -0.02, 1.26]}
            rotation={[0, -0.82, 0]}
        />

    </>
}
