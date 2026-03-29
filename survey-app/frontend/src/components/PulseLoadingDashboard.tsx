import { motion } from 'framer-motion';

/** Стеклянные блоки с «пульсацией» на время загрузки дашборда. */
export default function PulseLoadingDashboard() {
  const blocks = [0, 1, 2, 3];
  return (
    <div className="pulse-dash-loader" aria-busy="true" aria-label="Загрузка панели">
      <div className="pulse-dash-loader-grid">
        {blocks.map((i) => (
          <motion.div
            key={i}
            className="pulse-dash-loader-card glass-surface"
            initial={{ opacity: 0.4, scale: 0.98 }}
            animate={{ opacity: [0.45, 0.95, 0.45], scale: [0.98, 1, 0.98] }}
            transition={{
              duration: 2.2,
              repeat: Infinity,
              delay: i * 0.18,
              ease: 'easeInOut',
            }}
          >
            <div className="pulse-dash-loader-line pulse-dash-loader-line--long" />
            <div className="pulse-dash-loader-line pulse-dash-loader-line--mid" />
            <div className="pulse-dash-loader-ekg">
              <motion.span
                className="pulse-dash-loader-bar"
                animate={{ scaleX: [0.2, 1, 0.35, 0.9, 0.2], opacity: [0.4, 1, 0.55, 0.85, 0.4] }}
                transition={{ duration: 2.4, repeat: Infinity, delay: i * 0.12, ease: 'easeInOut' }}
              />
            </div>
          </motion.div>
        ))}
      </div>
      <p className="muted pulse-dash-loader-caption">Загружаем опросы…</p>
    </div>
  );
}
