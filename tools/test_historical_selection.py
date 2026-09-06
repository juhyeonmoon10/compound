"""Synthetic unit check: holdout outcomes cannot affect fitted calibration choices."""
import unittest
import numpy as np
import pandas as pd
from collect_historical_evidence import select_nested_model


class SelectionIsolationTest(unittest.TestCase):
    def test_holdout_values_do_not_choose_model(self):
        rng=np.random.default_rng(17)
        training=[]; holdout=[]
        compounds=["SOFT","MEDIUM","HARD"]
        for driver in range(20):
            order=rng.permutation(compounds)
            for stint,compound in enumerate(order):
                initial=int(rng.integers(0,4))
                for life in range(1,15):
                    lap=stint*16+life+initial
                    alpha={"SOFT":.06,"MEDIUM":.04,"HARD":.02}[compound]
                    beta=.002 if compound=="SOFT" else 0
                    row={"Driver":f"D{driver}","Stint":stint+1,"Compound":compound,"TyreLife":life,"LapNumber":lap,"TrackTemp":32+float(rng.normal()),"LapTimeSeconds":90+driver*.03-lap*.04+alpha*life+beta*life**2+float(rng.normal(0,.025))}
                    (training if life<=10 else holdout).append(row)
        train=pd.DataFrame(training); test=pd.DataFrame(holdout)
        original=select_nested_model(train,test)
        perturbed=test.copy(); perturbed["LapTimeSeconds"]+=100
        changed=select_nested_model(train,perturbed)
        self.assertEqual(original["coefficients"],changed["coefficients"])
        self.assertEqual(original["quadraticCompounds"],changed["quadraticCompounds"])
        self.assertGreater(sum(row["accepted"] for row in original["coefficients"]),0)
        self.assertGreater(changed["validation"]["maeSeconds"],original["validation"]["maeSeconds"]+90)


if __name__=="__main__":
    unittest.main()
