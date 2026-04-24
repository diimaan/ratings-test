import { motion } from 'framer-motion';
import { FaCopy, FaExternalLinkAlt } from 'react-icons/fa';
import { toast } from 'react-toastify';
import { SiStremio } from "react-icons/si";
import { useEffect } from 'react';
import RatingCard from './components/RatingCard';
import showCase from './assets/showcase.png';
import { AddonManagerCard } from './components/AddonManagerCard';
import { initGTM } from './utils/gtm';
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";

const SponsorBanner = ({ html }) => {
  return (
    <motion.div
      className="relative mx-auto mt-6 bg-[#0f1a2f] text-sm sm:text-base text-gray-200 px-6 py-4 rounded-xl shadow max-w-2xl backdrop-blur border border-white/5"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.3 }}
    >
      <div
        className="sponsor-content flex items-start gap-4 text-left"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </motion.div>
  );
};


function App() {
  const manifestUrl = `/manifest.json`;
  const sponsorHTML = process.env.VITE_HOME_BLURB;
  const addonVersion = process.env.VERSION || '0.0.0';

  useEffect(() => {
    initGTM();
    window.dataLayer.push({ event: 'pageview', page: window.location.pathname });
  }, []);

  const handleCopy = () => {
    const absoluteUrl = new URL(manifestUrl, window.location.origin).href;
    navigator.clipboard.writeText(absoluteUrl)
      .then(() => toast.success('Manifest URL copied!'))
      .catch(() => toast.error('Failed to copy URL'));
  };

  const handleStremioWeb = () => {
    const url = new URL(manifestUrl, window.location.origin).href;
    window.open(`https://web.stremio.com/#/addons?addon=${encodeURIComponent(url)}`, '_blank');
  };

  const handleStremioApp = () => {
    const absoluteManifestUrl = new URL(manifestUrl, window.location.origin).href;
    const deepLink = absoluteManifestUrl.replace(/^https?:\/\//i, 'stremio://');
    window.location.href = deepLink;
  };
  

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
            className="text-4xl sm:text-6xl font-extrabold gradient-text"
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

        <motion.div
          className="flex flex-col sm:flex-row justify-center gap-4 mb-16"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
        >
          <button onClick={handleCopy} className="button-gradient px-6 py-3 rounded-lg flex items-center justify-center gap-2 font-semibold">
            <FaCopy /> Copy URL
          </button>
          <button onClick={handleStremioWeb} className="button-gradient px-6 py-3 rounded-lg flex items-center justify-center gap-2 font-semibold">
            <FaExternalLinkAlt /> Stremio Web
          </button>
          <button onClick={handleStremioApp} className="button-gradient px-6 py-3 rounded-lg flex items-center justify-center gap-2 font-semibold">
            <SiStremio /> Open Stremio
          </button>
        </motion.div>

        <motion.div
          className="mb-16 flex justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
        >
          <img
            src={showCase}
            alt="Showcase"
            className="w-full max-w-sm h-auto rounded-lg shadow-lg"
          />
        </motion.div>

        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 mb-16">
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
