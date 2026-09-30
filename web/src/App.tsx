import { Link, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Account } from './pages/Account';
import { DayPass } from './pages/DayPass';
import { Guests } from './pages/Guests';
import { Home } from './pages/Home';
import { Join } from './pages/Join';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { MockPay, PaymentResult } from './pages/Payment';
import { Visit } from './pages/Visit';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="join" element={<Join />} />
        <Route path="login" element={<Login />} />
        <Route path="register" element={<Register />} />
        <Route path="account" element={<Account />} />
        <Route path="guests" element={<Guests />} />
        <Route path="day-pass" element={<DayPass />} />
        <Route path="visit/:id" element={<Visit />} />
        <Route path="payment/result" element={<PaymentResult />} />
        <Route path="mock-pay/:paymentId" element={<MockPay />} />
        <Route
          path="*"
          element={
            <div className="py-20 text-center">
              <p className="text-lg text-stone-600">Page not found.</p>
              <Link to="/" className="mt-4 inline-block font-semibold text-brand-700">
                Go home
              </Link>
            </div>
          }
        />
      </Route>
    </Routes>
  );
}
