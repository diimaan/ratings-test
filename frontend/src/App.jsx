import { motion } from 'framer-motion';
import { useEffect } from 'react';
import RatingCard from './components/RatingCard';
import { AddonManagerCard } from './components/AddonManagerCard';
import { ConfigBuilder } from './components/ConfigBuilder';
import { initGTM } from './utils/gtm';
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";

const SponsorBanner = ({ html }) => {
  return (
    <motion.div
      className="relative mx-auto mt-6 flex max-w-5xl items-center justify-center rounded-xl border border-white/5 bg-[#0f1a2f] px-6 py-5 text-center text-sm text-gray-200 shadow backdrop-blur sm:text-base"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.3 }}
    >
      <div
        className="sponsor-content w-full text-center"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </motion.div>
  );
};


function App() {
  const sponsorHTML = process.env.VITE_HOME_BLURB;
  const addonVersion = process.env.VERSION || '0.0.0';

  useEffect(() => {
    initGTM();
    window.dataLayer?.push({ event: 'pageview', page: window.location.pathname });
  }, []);

  return (
    <div className="min-h-screen py-10 px-4 sm:px-6 lg:px-8 bg-[#0f172a] text-white">
      <Analytics />
      <SpeedInsights />

      <motion.div
        className="max-w-7xl mx-auto"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
      >
        <header className="text-center mb-12 space-y-4">
          <motion.h1
            className="pb-2 text-4xl font-extrabold leading-[1.15] gradient-text sm:text-6xl"
            initial={{ scale: 0.9 }}
            animate={{ scale: 1 }}
            transition={{ duration: 0.5 }}
          >
            Ratings Aggregator
          </motion.h1>
          <p className="text-xl sm:text-2xl text-gray-300">
            Your all-in-one movie and TV show ratings aggregator for Stremio
          </p>
          
          {sponsorHTML && <SponsorBanner html={sponsorHTML} />}

        </header>

        <ConfigBuilder />

        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 my-16">
          <RatingCard
            title="Multi-Source Ratings"
            description="Native IMDb and TMDb ratings, plus broader cross-source coverage through MDBList."
            icon="📊"
          />
          <RatingCard
            title="Safety Signals"
            description="Age guidance and key warnings derived from the aggregation layer when available."
            icon="👪"
          />
          <RatingCard
            title="Configurable Output"
            description="Compact or full display with user-controlled rating selection and ordering."
            icon="⚙️"
          />
        </section>

        <AddonManagerCard />

        <motion.footer
          className="text-center mt-12 text-gray-400 text-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
        >
          {/* Version {addonVersion} •  */}
          Made with ❤️ for Stremio
        </motion.footer>
      </motion.div>
    </div>
  );
}

export default App;
