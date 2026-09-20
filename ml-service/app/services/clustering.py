"""Demand-tier clustering with ordered centroid labels."""

from __future__ import annotations

from typing import Any


def cluster_stations(stations: list[dict[str, Any]]) -> list[dict[str, Any]]:
    values = [float(item.get("predicted_demand", 0)) for item in stations]
    if not values:
        return []
    if len(values) >= 3:
        try:
            from sklearn.cluster import KMeans
            labels = KMeans(n_clusters=3, random_state=42, n_init=10).fit_predict([[value] for value in values])
            centers = {label: float(sum(values[index] for index, value_label in enumerate(labels) if value_label == label) / max(1, sum(value_label == label for value_label in labels))) for label in set(labels)}
            ordered = sorted(centers, key=centers.get)
            tiers = {ordered[0]: "Low Demand", ordered[1]: "Moderate Demand", ordered[2]: "High Demand"}
            return [{**station, "cluster": int(labels[index]), "demand_tier": tiers[labels[index]], "cluster_source": "K-Means"} for index, station in enumerate(stations)]
        except Exception:
            pass
    ordered = sorted(range(len(values)), key=lambda index: values[index])
    tiers = {index: ("Low Demand" if rank < len(values) / 3 else "High Demand" if rank >= len(values) * 2 / 3 else "Moderate Demand") for rank, index in enumerate(ordered)}
    return [{**station, "cluster": None, "demand_tier": tiers[index], "cluster_source": "ordered fallback"} for index, station in enumerate(stations)]
