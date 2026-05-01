const RatingCard = ({ title, description, icon }) => {
  return (
    <div className="card-gradient p-6 rounded-xl border border-gray-700">
      <div className="text-4xl mb-4">{icon}</div>
      <h3 className="text-xl font-semibold mb-2">{title}</h3>
      <p className="text-gray-400">{description}</p>
    </div>
  );
};

export default RatingCard;