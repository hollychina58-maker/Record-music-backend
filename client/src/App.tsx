import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense, useEffect } from 'react';
import { Layout } from './components/Layout';
import { ToastContainer, useToast } from './components/Toast';
import { MusicBannerProvider, useMusicBanner } from './components/MusicBanner';
import { useLanguage } from './i18n/LanguageContext';
import { apiService } from './services/api';
import { useAuthStore } from './stores/authStore';
import { useNotificationStore } from './stores/notificationStore';
import { HomePage } from './pages/HomePage';
import { CreateStoryPage } from './pages/CreateStoryPage';
import { StoryDetailPage } from './pages/StoryDetailPage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { ProfilePage } from './pages/ProfilePage';
import { PaymentPage } from './pages/PaymentPage';
import { CheckoutPage } from './pages/CheckoutPage';
import { MySpacePage } from './pages/MySpacePage';
import { PhotoInspirationPage } from './pages/PhotoInspirationPage';
import { UserProfilePage } from './pages/UserProfilePage';

const AdminLayout = lazy(() => import('./pages/admin/AdminLayout').then(m => ({ default: m.AdminLayout })));
const Dashboard = lazy(() => import('./pages/admin/Dashboard').then(m => ({ default: m.Dashboard })));
const AdminStoriesPage = lazy(() => import('./pages/admin/AdminStoriesPage').then(m => ({ default: m.AdminStoriesPage })));
const AdminCommentsPage = lazy(() => import('./pages/admin/AdminCommentsPage').then(m => ({ default: m.AdminCommentsPage })));
const AdminUsersPage = lazy(() => import('./pages/admin/AdminUsersPage').then(m => ({ default: m.AdminUsersPage })));
const AdminProductsPage = lazy(() => import('./pages/admin/AdminProductsPage').then(m => ({ default: m.AdminProductsPage })));
const AdminOrdersPage = lazy(() => import('./pages/admin/AdminOrdersPage').then(m => ({ default: m.AdminOrdersPage })));

function AdminFallback() {
  return <div style={{ display:'flex',justifyContent:'center',padding:'80px 0',color:'#bbb',fontFamily:'"Noto Serif SC",serif' }}>加载中...</div>;
}

function AdminGuard({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (user?.role !== 'admin') return <Navigate to="/" replace />;
  return <>{children}</>;
}

function PendingMusicPoller() {
  const { addToast } = useToast();
  const { showMusicBanner } = useMusicBanner();

  useEffect(() => {
    const KEY = 'mo_pending_music';

    const poll = async () => {
      const raw = localStorage.getItem(KEY);
      if (!raw) return;

      let pending: Array<{ musicId: number; storyId: number; createdAt: number }>;
      try { pending = JSON.parse(raw); } catch { return; }
      if (pending.length === 0) return;

      const remaining: typeof pending = [];
      for (const item of pending) {
        try {
          const status = await apiService.pollMusicStatus(item.musicId);
          if (status.status === 'completed') {
            useAuthStore.getState().fetchCurrentUser();
            showMusicBanner(item.storyId);
            // completed — do NOT add back to pending list
          } else if (status.status === 'failed') {
            addToast('error', '配乐生成失败，请重试');
            // failed — do NOT add back (don't retry automatically)
          } else if (Date.now() - item.createdAt > 300000) {
            addToast('error', '配乐生成超时，请重试');
            // timed out — remove from list
          } else {
            remaining.push(item);
          }
        } catch {
          if (Date.now() - item.createdAt < 300000) remaining.push(item);
        }
      }

      if (remaining.length > 0) {
        localStorage.setItem(KEY, JSON.stringify(remaining));
      } else {
        localStorage.removeItem(KEY);
      }
    };

    poll();
    const interval = setInterval(poll, 5000);
    return () => clearInterval(interval);
  }, [addToast, showMusicBanner]);

  return null;
}

function NotificationPoller() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const setUnreadCount = useNotificationStore((s) => s.setUnreadCount);

  useEffect(() => {
    if (!isAuthenticated) return;
    const poll = () => {
      apiService.clientGet('/notifications/unread-count')
        .then((d: any) => setUnreadCount(d.count ?? 0))
        .catch(() => {});
    };
    poll();
    const interval = setInterval(poll, 30000);
    return () => clearInterval(interval);
  }, [isAuthenticated, setUnreadCount]);

  return null;
}

function App() {
  const { language, dir } = useLanguage();

  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = dir;
  }, [language, dir]);

  return (
    <BrowserRouter>
      <MusicBannerProvider>
        <Layout>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/create" element={<CreateStoryPage />} />
            <Route path="/inspiration" element={<PhotoInspirationPage />} />
            <Route path="/story/:id" element={<StoryDetailPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/my-space" element={<MySpacePage />} />
            <Route path="/payment" element={<PaymentPage />} />
            <Route path="/user/:id" element={<UserProfilePage />} />
            <Route path="/checkout" element={<CheckoutPage />} />
            <Route path="/admin" element={<AdminGuard><Suspense fallback={<AdminFallback />}><AdminLayout /></Suspense></AdminGuard>}>
              <Route index element={<Suspense fallback={<AdminFallback />}><Dashboard /></Suspense>} />
              <Route path="stories" element={<Suspense fallback={<AdminFallback />}><AdminStoriesPage /></Suspense>} />
              <Route path="comments" element={<Suspense fallback={<AdminFallback />}><AdminCommentsPage /></Suspense>} />
              <Route path="users" element={<Suspense fallback={<AdminFallback />}><AdminUsersPage /></Suspense>} />
              <Route path="products" element={<Suspense fallback={<AdminFallback />}><AdminProductsPage /></Suspense>} />
              <Route path="orders" element={<Suspense fallback={<AdminFallback />}><AdminOrdersPage /></Suspense>} />
            </Route>
          </Routes>
          <PendingMusicPoller />
          <NotificationPoller />
          <ToastContainer />
        </Layout>
      </MusicBannerProvider>
    </BrowserRouter>
  );
}

export default App;
