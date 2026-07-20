import Navbar from './components/Navbar.jsx'
import Footer from './components/Footer.jsx'
import ChatDashboard from './pages/ChatDashboard.jsx'
import './styles/global.css'

export default function App() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <Navbar />
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <ChatDashboard />
      </main>
    </div>
  )
}
