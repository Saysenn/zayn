import { Navigate } from 'react-router-dom';
import { useSession } from '../../hooks/useAuth';

export default function RedirectIfAuthed({ children }) {
  const { data: session, isLoading } = useSession();

  if (isLoading) return null;
  if (session?.loggedIn) return <Navigate to="/" replace />;
  return children;
}
