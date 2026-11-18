import React, { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { WeddingProvider } from './context/WeddingContext';
import { Navbar } from './components/Navbar';
import { Footer } from './components/Footer';
import { CartDrawer } from './components/CartDrawer';
import { FloatingGiftButton } from './components/FloatingGiftButton';
import { FallingPetalsBackground } from './components/FallingPetalsBackground';
import { PrivacyModal } from './components/PrivacyModal';
import { HomePage } from './pages/HomePage';
import { StoryPage } from './pages/StoryPage';
import { GiftsPage } from './pages/GiftsPage';
import { PixGiftPage } from './pages/PixGiftPage';
import { CardGiftPage } from './pages/CardGiftPage';
import { ThankYouPage } from './pages/ThankYouPage';
import { RsvpPage } from './pages/RsvpPage';
import { GuestbookPage } from './pages/GuestbookPage';
import { GalleryPage } from './pages/GalleryPage';
import { CeremonyPage } from './pages/CeremonyPage';
import { FaqPage } from './pages/FaqPage';
import { AdminPage } from './pages/AdminPage';

const ScrollToTop: React.FC = () => {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
};

const LegacyPixRedirect: React.FC = () => {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const method = params.get('method');
  params.delete('method');
  const query = params.toString();
  const targetBase = method === 'card' ? '/presentear/cartao' : '/presentear/pix';
  return <Navigate to={query ? `${targetBase}?${query}` : targetBase} replace />;
};

export default function App() {
  return (
    <WeddingProvider>
      <BrowserRouter>
        <ScrollToTop />
          <div className="watercolor-paper relative flex min-h-screen flex-col text-marrom">
            <FallingPetalsBackground />
            <Navbar />
            <main className="relative flex-1">
              <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/historia" element={<StoryPage />} />
                <Route path="/presentes" element={<GiftsPage />} />
                <Route path="/presentear/pix" element={<PixGiftPage />} />
                <Route path="/presentear/cartao" element={<CardGiftPage />} />
                <Route path="/pix" element={<LegacyPixRedirect />} />
                <Route path="/obrigado" element={<ThankYouPage />} />
                <Route path="/rsvp" element={<RsvpPage />} />
                <Route path="/recados" element={<GuestbookPage />} />
                <Route path="/galeria" element={<GalleryPage />} />
                <Route path="/cerimonia" element={<CeremonyPage />} />
                <Route path="/faq" element={<FaqPage />} />
                <Route path="/admin" element={<AdminPage />} />
                <Route path="*" element={<HomePage />} />
              </Routes>
            </main>
            <Footer />
            <FloatingGiftButton />
            <CartDrawer />
            <PrivacyModal />
          </div>
      </BrowserRouter>
    </WeddingProvider>
  );
}
