import { useEffect } from 'react';
import RatingCard from './components/RatingCard';
import { AddonManagerCard } from './components/AddonManagerCard';
import { ConfigBuilder } from './components/ConfigBuilder';
import { initGTM } from './utils/gtm';
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";

const SponsorBanner = ({ html }) => {
  return (
    <div
      className="relative mx-auto mt-6 flex max-w-5xl items-center justify-center rounded-xl border border-white/5 bg-[#0f1a2f] px-6 py-5 text-center text-sm text-gray-200 shadow backdrop-blur sm:text-base"
    >
      <div
        className="sponsor-content w-full text-center"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
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

      <div className="max-w-7xl mx-auto">
        <header className="text-center mb-12 space-y-4">
          <h1 className="pb-2 text-4xl font-extrabold leading-[1.15] gradient-text sm:text-6xl">
            Ratings Aggregator
          </h1>
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

        <footer className="text-center mt-12 text-gray-400 text-sm">
          {/* Version {addonVersion} •  */}
          Made with ❤️ for Stremio
        </footer>
      </div>
    </div>
  );
}

export default App;
