import pandas as pd
import random
import json

random.seed(42)

# Advisor archetypes
advisors = ["CFO", "Adventurer", "Builder", "Future Self", "Spouse/Partner", 
            "Therapist", "Chaos Goblin", "80-Year-Old You", "Inner Critic", "Dad Voice"]

# Decision categories with realistic sample decisions
decisions_by_category = {
    "Career": [
        "Should I ask for a promotion or wait for it to be offered?",
        "Should I take the job offer with higher pay but longer commute?",
        "Should I pivot from engineering to product management?",
        "Should I go back to school for an MBA?",
        "Should I accept the remote role or stay hybrid?",
        "Should I start freelancing on the side?",
        "Should I confront my manager about the toxic team culture?",
        "Should I take the startup offer over the corporate role?",
        "Should I negotiate my salary or accept the initial offer?",
        "Should I leave my stable job to travel for a year?",
        "Should I apply for the leadership role I feel underqualified for?",
        "Should I accept the lateral move to a different department?",
        "Should I tell my boss I'm looking for other opportunities?",
        "Should I take the contract role for more money but less stability?",
        "Should I pursue the overseas assignment?",
    ],
    "Finance": [
        "Should I invest in index funds or individual stocks?",
        "Should I buy a house now or wait for prices to drop?",
        "Should I pay off student loans aggressively or invest the difference?",
        "Should I take on a side hustle for extra income?",
        "Should I lend money to my friend who asked?",
        "Should I buy the new car or keep driving my old one?",
        "Should I max out my 401k or save for a down payment?",
        "Should I hire a financial advisor or manage investments myself?",
        "Should I refinance my mortgage at current rates?",
        "Should I start a business with my savings?",
        "Should I co-sign my sibling's loan?",
        "Should I sell my stocks during this market dip?",
        "Should I take the early retirement package?",
        "Should I rent or buy in this market?",
        "Should I invest in crypto or stick with traditional assets?",
    ],
    "Relationships": [
        "Should I have the difficult conversation about our future?",
        "Should I move in with my partner after 6 months?",
        "Should I set boundaries with my overbearing parent?",
        "Should I end a friendship that feels one-sided?",
        "Should I try couples therapy or work on things ourselves?",
        "Should I tell my friend their partner is bad for them?",
        "Should I reconnect with my estranged sibling?",
        "Should I introduce my new partner to my kids?",
        "Should I forgive my friend for breaking my trust?",
        "Should I move closer to family or stay where my life is?",
        "Should I confront my roommate about their behavior?",
        "Should I attend the wedding of someone who hurt me?",
        "Should I tell my partner about my past?",
        "Should I prioritize my relationship or my career right now?",
        "Should I say yes to being a bridesmaid when I can't afford it?",
    ],
    "Health": [
        "Should I commit to the early morning workout routine?",
        "Should I try therapy or keep managing on my own?",
        "Should I go vegetarian for health reasons?",
        "Should I get the elective surgery now or wait?",
        "Should I take the medication my doctor prescribed?",
        "Should I train for a marathon even though I've never run?",
        "Should I prioritize sleep over my social life?",
        "Should I try meditation even though I'm skeptical?",
        "Should I quit drinking for a year?",
        "Should I switch to a standing desk?",
        "Should I see a specialist about this recurring issue?",
        "Should I take a mental health day even though work is busy?",
        "Should I try the elimination diet my friend recommended?",
        "Should I join the gym or exercise at home?",
        "Should I take a sabbatical for burnout recovery?",
    ],
    "Personal Growth": [
        "Should I start writing the book I've been thinking about?",
        "Should I learn a new language or a new instrument?",
        "Should I volunteer for the nonprofit board position?",
        "Should I go to the networking event even though I hate them?",
        "Should I start a podcast about my niche interest?",
        "Should I take the public speaking course?",
        "Should I delete social media for a month?",
        "Should I hire a life coach?",
        "Should I commit to journaling daily?",
        "Should I say yes to the scary opportunity?",
        "Should I read more books or take more courses?",
        "Should I start the creative project I keep postponing?",
        "Should I join the mastermind group?",
        "Should I set a strict morning routine?",
        "Should I attend the silent retreat?",
    ],
    "Lifestyle": [
        "Should I adopt a dog even though my schedule is busy?",
        "Should I move to a new city where I know no one?",
        "Should I downsize my apartment to save money?",
        "Should I buy the expensive thing that would make me happy?",
        "Should I commit to minimalism and declutter everything?",
        "Should I take the solo trip or wait for friends to be available?",
        "Should I get a roommate to split costs?",
        "Should I switch to a plant-based diet?",
        "Should I sell my car and use public transit?",
        "Should I renovate the kitchen or move to a new place?",
        "Should I adopt a cat (my third)?",
        "Should I sign the year-long lease or go month-to-month?",
        "Should I invest in the expensive hobby equipment?",
        "Should I move back to my hometown?",
        "Should I take the sabbatical and travel?",
    ],
    "Creative": [
        "Should I quit my day job to pursue art full-time?",
        "Should I share my creative work publicly?",
        "Should I take the unconventional career path?",
        "Should I collaborate with someone whose style differs from mine?",
        "Should I apply to the residency program abroad?",
        "Should I self-publish or try traditional publishing?",
        "Should I pivot my creative direction entirely?",
        "Should I invest in professional equipment or keep bootstrapping?",
        "Should I take the commercial project for money even if it's not my passion?",
        "Should I enter the competition even though I might not win?",
    ],
}

# Generate 500 decisions
data = []
for i in range(1, 501):
    category = random.choice(list(decisions_by_category.keys()))
    decision_text = random.choice(decisions_by_category[category])
    
    # Select 3-5 advisors
    num_advisors = random.randint(3, 5)
    selected_advisors = random.sample(advisors, num_advisors)
    
    # Generate votes with realistic patterns
    votes = {}
    for advisor in selected_advisors:
        # Weight votes based on advisor personality
        if advisor == "CFO":
            vote = random.choices(["Yes", "No", "Abstain"], weights=[30, 45, 25])[0]
        elif advisor == "Adventurer":
            vote = random.choices(["Yes", "No", "Abstain"], weights=[70, 15, 15])[0]
        elif advisor == "Chaos Goblin":
            vote = random.choices(["Yes", "No", "Abstain"], weights=[45, 20, 35])[0]
        elif advisor == "Therapist":
            vote = random.choices(["Yes", "No", "Abstain"], weights=[40, 25, 35])[0]
        elif advisor == "Inner Critic":
            vote = random.choices(["Yes", "No", "Abstain"], weights=[20, 55, 25])[0]
        elif advisor == "Dad Voice":
            vote = random.choices(["Yes", "No", "Abstain"], weights=[35, 40, 25])[0]
        elif advisor == "Future Self":
            vote = random.choices(["Yes", "No", "Abstain"], weights=[55, 25, 20])[0]
        elif advisor == "80-Year-Old You":
            vote = random.choices(["Yes", "No", "Abstain"], weights=[60, 20, 20])[0]
        elif advisor == "Builder":
            vote = random.choices(["Yes", "No", "Abstain"], weights=[50, 30, 20])[0]
        else:  # Spouse/Partner
            vote = random.choices(["Yes", "No", "Abstain"], weights=[40, 35, 25])[0]
        votes[advisor] = vote
    
    # Determine final choice based on vote majority with some randomness
    yes_count = sum(1 for v in votes.values() if v == "Yes")
    no_count = sum(1 for v in votes.values() if v == "No")
    
    if yes_count > no_count:
        final_choice = random.choices(
            ["Proceeded (aligned with majority)", "Chose alternative path", "Delayed decision"],
            weights=[60, 25, 15]
        )[0]
    else:
        final_choice = random.choices(
            ["Proceeded anyway", "Did not proceed (aligned with majority)", "Chose compromise"],
            weights=[30, 50, 20]
        )[0]
    
    # Outcome correlated with alignment
    aligned = ("aligned" in final_choice.lower())
    if aligned:
        outcome = random.choices(
            ["Successful", "Mixed", "Unsuccessful", "Pending"],
            weights=[45, 30, 10, 15]
        )[0]
    else:
        outcome = random.choices(
            ["Successful", "Mixed", "Unsuccessful", "Pending"],
            weights=[30, 35, 20, 15]
        )[0]
    
    # Satisfaction correlated with outcome
    if outcome == "Successful":
        satisfaction = random.choices([3, 4, 5], weights=[15, 40, 45])[0]
    elif outcome == "Mixed":
        satisfaction = random.choices([2, 3, 4], weights=[25, 50, 25])[0]
    elif outcome == "Unsuccessful":
        satisfaction = random.choices([1, 2, 3], weights=[40, 40, 20])[0]
    else:  # Pending
        satisfaction = random.choices([3, 4], weights=[60, 40])[0]
    
    data.append({
        "decision_id": f"DEC-{i:04d}",
        "category": category,
        "decision": decision_text,
        "advisors_present": ", ".join(selected_advisors),
        "num_advisors": num_advisors,
        "votes_json": json.dumps(votes),
        "yes_votes": yes_count,
        "no_votes": no_count,
        "abstain_votes": num_advisors - yes_count - no_count,
        "board_recommendation": "Yes" if yes_count > no_count else ("No" if no_count > yes_count else "Split"),
        "final_choice": final_choice,
        "user_aligned_with_board": aligned,
        "outcome": outcome,
        "satisfaction_score": satisfaction,
        "days_to_outcome": random.randint(3, 90) if outcome != "Pending" else None,
    })

df = pd.DataFrame(data)
df.to_csv("/home/ubuntu/fake_decision_dataset.csv", index=False)

# Print summary stats
print(f"Generated {len(df)} decisions")
print(f"\nCategory distribution:")
print(df['category'].value_counts().to_string())
print(f"\nOutcome distribution:")
print(df['outcome'].value_counts().to_string())
print(f"\nAverage satisfaction: {df['satisfaction_score'].mean():.2f}")
print(f"\nBoard alignment rate: {df['user_aligned_with_board'].mean():.1%}")
print(f"\nDataset saved to /home/ubuntu/fake_decision_dataset.csv")
